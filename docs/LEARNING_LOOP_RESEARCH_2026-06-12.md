# Learning Loop — Research + Build Plan (2026-06-12)

> Third deep-research round (103 agents, 21/25 verified) + learning-surface
> codebase map. Theme: make SwanBot LEARN from its own runs — desktop trace
> replay, trace→skill distillation, auto-buildout proposals. Companions:
> EXECUTION_LADDER_RESEARCH_2026-06-11.md, TOOLTREE_DESKTOP_RESEARCH_2026-06-10.md.

## Verified findings (full evidence in workflow record)

1. **Programmatic skill induction beats fresh exploration**: ASI +23.5%
   rel. success vs no-skill, +11.3% vs prose-memo skills (the gain is FROM
   verification at induction); SkillWeaver +31.8-39.8% rel.; skills
   synthesized by a strong model boost a weak executor up to +54.3% rel.
   (circle-shared library validated). Store skills as parameterized
   procedures, not prose or raw traces.
2. **Eval-before-promote is the lifecycle pattern** (ASI verification gate;
   Anthropic skill-creator benchmark mode + deprecation heuristic: if the
   base model passes the evals without the skill, retire it).
3. **Replay reliability = per-step precondition anchors + partial-execution
   + replan on mismatch** (UFO2: validate each batched action against live
   a11y state — up to 51.5% inference-cost cut, flat-to-better success;
   ActionEngine: failed step → vision re-ground → repair AND write the fix
   back into the stored skill). Never blind replay; recorded steps are
   hypotheses.
4. **Naive single-version trace reuse is measurably brittle** (TimeWarp +
   corroborating GUI-perturbation benchmarks: 27-56pt drops). Our browser
   drift rules are right; port them to desktop with a11y precondition
   anchors. (TimeWarp's own remedy numbers were REFUTED — use only the
   brittleness finding.)
5. **UFO2's desktop trace mining is the template**: offline-mine run logs
   into app-scoped Example records (task signature + step plan), retrieve
   as in-context examples (NOT forced replay). Caution: self-experience
   retrieval REGRESSED o1's overall success (25.3→20.8) while helping
   plan-error recovery — measure per-app benefit, don't assume; injection
   should be conservative.
6. **62% of desktop failures are control detection** (UIA-only config) —
   our E1 breadcrumbs instrument the right lever; hybrid a11y+vision is
   re-validated.
7. **No production system ships autonomous failure→adapter buildout**
   (Anthropic/OpenAI keep skill creation human-initiated with
   model-assisted drafting). Evidence-backed design: auto-DETECT (breadcrumb
   aggregation) → auto-DRAFT proposal → existing HITL approval +
   eval-before-promote.
8. **Demonstration learning** has one narrow verified point (OpenAdapt:
   demo-in-context 46.7%→100% FIRST-ACTION accuracy on 45 macOS tasks;
   recording-pipeline claims refuted) — directionally supports
   demo-as-context later, not buildable on this evidence.
9. **Open questions**: temporal staleness windows unvalidated (our 45-day
   TTL is a heuristic); strong-model regression (gate injection by
   model/novelty?); macOS AX coverage rates (our breadcrumbs will answer).

## L-items

- **L0 SHIPPED (2026-06-12, pre-research quick wins)** — escalation
  breadcrumbs persisted + rendered on console/Office cards (producer
  one-liner pending in ChatTab — frozen during the round);
  useComputerUseQueue wired into the console (opt-in auto-start, default
  off, ≤3 parallel + ≤6 waiting); pairing-token secondary store
  (encrypted IndexedDB / secure-store read-through). Smokes:
  computer-task-complexity, computer-use-queue (new), desktop-bridge.
- **L1 — Desktop action-trace capture + retrieval-as-context.** Capture
  bounded (≤40), credential-redacted desktop/app tool-action traces at
  execution time in `computerTaskRuntime`; persist on the run row
  (agent_runs metadata — no new SQL); on a new task matching a prior
  successful one (normalized text, 45-day window, mirroring the edge
  loop's matcher), inject as an EXAMPLE block with drift rules +
  precondition anchors (verify element exists/enabled via a11y before
  each replayed step; stop + re-ground on mismatch). Conservative per
  finding 5: example, never forced script.
- **L2 — Hybrid recipes + lifecycle.** Recipe drafts embed the redacted
  trace (deterministic-replay section + adaptive-fallback section) and
  parameter slots; after a recipe-guided run, write back first-use
  outcome (pass/fail) onto skill usage stats; repeated failure flags the
  skill for review (deprecation signal per finding 2).
- **L3 — Auto-buildout PROPOSE trigger.** Pure per-app failure aggregation
  (E1 breadcrumbs + recovery records + run failures) → at threshold (≥3
  same-app failures), auto-DRAFT a buildout proposal through the EXISTING
  `requestConnectedAppCapabilityBuildout` + HITL approval path. Never
  auto-build.
- **L4 — Learned app facts feeding the ladder.** Per-app observed facts
  (surface that succeeded, a11y-empty rate, last-known-good rung) recorded
  from run outcomes; fed into E1's `capabilityStatusById`/ranking so the
  ladder starts on the rung that worked last time. Device-storage
  persisted, bounded.

## L-item status (2026-06-12 — typecheck clean, smokes green)

- **L1 SHIPPED** — desktop trace capture (edge-parity redaction, ≤40
  actions, success-only — and NOT persisted when surface escalations fired,
  per the brittleness finding) harvested from the persisted v2 tool-event
  stream; stored on `agent_runs.metadata.desktopActionTrace` (no new SQL);
  exact-normalized-match retrieval (45d) injects a ≤2.5k EXAMPLE block with
  hypothesis/precondition rules; newest-successful-trace-wins write-back.
  Smoke: desktop-action-trace (60 asserts incl. cross-file parity pins).
- **L2 SHIPPED** — hybrid recipes: deterministic-replay section (hypothesis
  rule first, steps ≤120ch) + parameter slots (url/path/date/name
  heuristics, ≤8) bounded 6k, no-trace output byte-identical;
  `actionTrace` field on the durable task record (console passes it to
  Save-as-recipe); skill usage stats in device storage (circle_skills has
  no jsonb and writes are HITL-only — documented decision) merged at read
  time; `evaluateSkillHealth` (failing = 2-streak or <50%/≥4; stale = 90d)
  with "⚠ failing — review" marker in prompt injection + console health
  hints. NO auto-deactivation. Smokes: skill-lifecycle (new),
  computer-task-complexity.
- **L3 SHIPPED** — auto-PROPOSE only: ≥3 best-rung failures with no
  success OR a11yEmptyCount ≥3 → draft buildout proposal through the
  existing HITL path (7-day cooldown, dupe-guard; no connected agent ⇒
  unmet proposal recorded on facts, never dispatched). Bonus fix: the
  pre-existing buildout call ran un-gated because no runId reached the
  approval gate — now threaded, so proposals land as pending approvals.
- **L4 SHIPPED** — `appLearnedFacts.ts`: per-app surface outcomes (≤8
  rungs, ≤30 apps LRU, counters capped), a11y-empty/stale counters,
  conservative hint derivation (≥3 fails + 0 oks ⇒ 'partial'; success ⇒
  'ready' hint) merged into E1's capabilityStatusById with AUDIT-WINS
  conflict rules (hints fill gaps/demote, never promote). Smoke:
  app-learned-facts (63 cases).
- **UI follow-ups noted**: surface `unmetBuildoutProposal` in buildout UI;
  fold post-retry outcomes into facts; ChatTab producer one-liner for
  escalation breadcrumbs (from L0).
