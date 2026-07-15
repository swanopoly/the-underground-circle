# docs/archive

Historical plans and audits kept for context, **superseded by newer docs**.
Do not act on these unless cross-referenced from the active roadmap.

## Contents

| File | Superseded by | Why archived |
|---|---|---|
| `LAUNCH_AUDIT_2026-02-24.md` | `docs/OPTIMIZATION_PLAN.md` + `docs/AGENTS_ROADMAP.md` §3 Phase 0 | Pre-missions, pre-agents roadmap. Most P0s listed here have shipped. |
| `OFFICE_DASHBOARD_DEEP_AUDIT_2026-04-03.md` | `docs/OPTIMIZATION_PLAN.md` (2026-04-20) | 17 days older, narrower scope. Findings absorbed into the canonical optimization plan. |
| `OPENSWAN_ARCHITECTURE_AUDIT_2026-04-15.md` | `docs/OPENSWAN_AGENT_IMPLEMENTATION_PLAN.md` + `docs/AGENTS_ROADMAP.md` §2 | Audit of what shipped pre-Hermes. Useful context; execution plan lives in the newer docs. |
| `supabase-migration.sql` / `supabase-migration-fixed.sql` | `docs/RUN_THIS_SQL.sql` | Ancient (2026-03-06), partially applied. All still-needed statements are in the canonical `RUN_THIS_SQL.sql`. |
| `AGENT_RUNTIME_DELTA_PLAN_2026-04-22.md` | `docs/PHASE_CA-8_AGENT_RUNTIME_DELTA_PLAN.md` | All top-10 delta items shipped via CA-8 (roadmap §CA-8, 2026-04-22/23). Its Part 4 priority table reads as open backlog but isn't. |
| `chat-tab-agent-cli-{deep-audit,expansion-master-roadmap,external-patterns-addendum,first-pr-dossier,implementation-spec}-2026-04-03.md` | CLAUDE.md Runtime Map (chat planning/execution) + `docs/CHAT_AGENT_ARCHITECTURE_IMPROVEMENT_PLAN.md` | Initiative ~40% executed (schema, mode concept, some component shells), then abandoned for inline `ChatTab.tsx` + unified `agent_runs`. Its prescribed `ChatTabShell`/`chatRunDispatcher`/`chat_run_*` architecture was never completed; `ChatSidebar.tsx`/`ChatTranscript.tsx` remain as dead code it created. |
| `agent-memory-retrieval-privacy-and-sql-dossier-2026-04-08.md`, `agent-memory-ux-and-compaction-implementation-plan-2026-04-08.md`, `agent-session-memory-deep-research-and-implementation-plan-2026-04-08.md`, `claude-agent-memory-review-and-recommendations-2026-04-08.md` | `docs/AGENT_MEMORY_GOD_PLAN.md` (§1 status table) | Four overlapping same-day memory deep-dives. Backend recommendations (RLS/visibility schema, metadata fixes, embeddings) shipped via `20260408_memory_v2_retrieval_privacy.sql` + `memoryEmbeddings.ts`; the unbuilt UI pieces (memory source chips, Room/Office memory panels) are noted in the UX/compaction plan if ever revived. |
| `feed-task-agent-execution-{deep-audit,implementation-spec,pr1-dossier}-2026-04-04.md` | shipped code: `taskExecutionRuntime.ts`, `taskCapabilityProfiles.ts`, kanban Task* panels, `20260404_feed_task_execution_runtime.sql` | PR1 deliverables fully implemented; docs read as open TODO lists but are done. |
| `xp-agent-evolution-{deep-audit,implementation-spec}-2026-04-04.md` | `src/lib/progression.ts` + `mastery.ts` (shipped backbone); CLAUDE.md Priority section | PR1 backbone shipped; PR2–PR4 (evolution ceremonies, reveal modals, combos) fall under CLAUDE.md's "games/decorative work are secondary" rule. Revive only if it strengthens the accountability loop. |
| `ai-agent-use-cases-and-openswan-deep-audit-2026-04-07.md` | CLAUDE.md Computer Use section + `docs/UC_APP_TASK_RELIABILITY_ARCHITECTURE.md` | Strategy audit whose central gap claim ("computer-use mostly missing") is now false — the nine-layer app/browser/desktop pipeline shipped after it was written. |
| `2026-04-02-schools-education-section.md`, `2026-04-09-onboarding-agents-memory.md` | shipped code (`agentIdentity.ts` `setMainAgentForProvider`, reworked `OnboardingFlow.tsx`) | Orphaned `docs/superpowers/plans/` convention — the "superpowers" skill system they reference doesn't exist in this repo. Content was mostly actioned, then superseded by later reworks. |

## Rule

If you find yourself considering an archived doc, **read the current canonical
doc first** (`docs/AGENTS_ROADMAP.md`). If the current doc is silent on the
subject, only *then* mine the archive — and open a PR to pull anything
still-relevant into a canonical location.
