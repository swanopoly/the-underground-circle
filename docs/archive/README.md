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

## Rule

If you find yourself considering an archived doc, **read the current canonical
doc first** (`docs/AGENTS_ROADMAP.md`). If the current doc is silent on the
subject, only *then* mine the archive — and open a PR to pull anything
still-relevant into a canonical location.
