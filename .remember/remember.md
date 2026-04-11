# Handoff

## State
24 commits to main this session. Full mission system with templates, tasks, agent dispatch, proof-of-work, streaks, celebration animation. Missions live inside Feed tab center panel (380px wide). Memory architecture overhauled: session bloat fixed, token budgets capped, RLS fixed, dedup constraint, blackswan_memory dropped. Landing page, circle discovery, agent reputation badges, push notifications all built. AgentPanel cleaned to 5-color palette. All edge functions deployed. Production build verified.

## Next
1. Run pending SQL if not done: `ALTER TABLE circles ADD COLUMN IF NOT EXISTS is_public boolean DEFAULT false; ALTER TABLE circles ADD COLUMN IF NOT EXISTS settings jsonb DEFAULT '{}'::jsonb; NOTIFY pgrst, 'reload schema';`
2. Run session dedup constraint: `CREATE UNIQUE INDEX IF NOT EXISTS idx_memory_session_dedup ON memory_entries (circle_id, source_surface, title, COALESCE(user_id, '00000000-0000-0000-0000-000000000000')) WHERE scope = 'session' AND is_active = true;`
3. Phase 4: Stripe pricing integration
4. Phase 3.2: Landing page needs screenshots/demo content

## Context
- Codex runs simultaneously and may modify agentRunSystem.ts, memoryService.ts, agentMemory.ts — check git log before editing
- `20260408_unified_agent_runs.sql` has broken FKs — use `20260411_memory_entries_standalone.sql` instead
- Tab dot animation uses `<div className="uc-tab-dot">` on web (not RN View) to avoid animation CSS warning
- Feed center panel is 380px, GoalsPanel is 220px, Kanban is flex:1
- Search bar is collapsible on desktop (collapsed by default, / key expands)
