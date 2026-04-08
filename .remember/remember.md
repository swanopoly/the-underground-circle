# Handoff

## State
Massive session continuing from April 2-8. All features compile clean. Key new systems this session: unified agent run system (`agentRunSystem.ts` + migration `20260408_unified_agent_runs.sql`), WordPress auto-posting with 12 `/wp` commands + featured image support, model capability router for image/webpage generation, enhanced Agent Panel with live bridge data, CMD+K full sitemap navigation, customizable agent name (localStorage per circle), robot FlatIcon replacing all swan emojis, deep thinking enabled (thinkingLevel: 'deep', 10K budget Sonnet/Opus, 8K Gemini). Bridge now serves rich live context (lastUserMessage, lastAssistantText, recentToolCalls, activeFiles, currentToolName).

## Next
1. **Run migration** — `20260408_unified_agent_runs.sql` needs to be run in Supabase SQL Editor (7 tables: agent_runs, agent_run_steps, agent_run_artifacts, agent_run_approvals, memory_entries, subagent_profiles, run_evaluations)
2. **Deploy edge function** — `npx supabase functions deploy swanbot-ai` (updated thinking levels + token limits)
3. **Build Run Viewer UI** — show active/past runs in Office and Feed with step trace, artifacts, approvals (data layer is built, UI next)
4. **Rooms as project workspaces** — Phase 3 from master plan: Room overview redesign with project memory, instructions, active runs, deliverables
5. **Mobile optimization** — still not started, user asked multiple times

## Context
- Master plan at `docs/page-audits/claude-cowork-openclaw-integration-master-plan-2026-04-08.md` — Phase 1 (shared primitives) is built, Phases 2-6 remain
- Agent name is now customizable per circle (stored in localStorage key `uc_agent_name_${circleId}`)
- All `🦢` replaced with FlatIcon `robot` (ID 3398643) — backward-compatible regex reads both `🦢` and `🤖` prefixed messages from DB
- WordPress commands: `/wp status`, `/wp list`, `/wp write <topic> | <image_url>`, `/wp publish <id>`, `/wp image <id> <url>`, etc.
- Pre-existing TS errors in RoomsTab, LoginScreen, PhotonProof, FlatIcon, officeConfig are known safe-to-ignore
