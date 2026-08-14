# Underground Circle — Full Optimization Plan

**Audit date:** 2026-04-20
**Scope:** End-to-end engineering audit of the UC app (Expo/React Native + Supabase + Netlify) with a prioritized remediation plan.
**Method:** Synthesis of docs (CLAUDE.md, AGENT.md, MEMORY.md, all audits in `docs/`) plus code-level inspection of `src/`, `scripts/`, `supabase/`, `package.json`, and live server state.

---

## 1. Executive Summary

UC is feature-rich, strict-TypeScript, and mostly architecturally sound, but five classes of issue are holding the app back:

1. **Production blockers** — OfficeTab hard-codes `http://localhost:18790`, there are no error boundaries on the three largest tabs, and several auth calls are unguarded. A single crash can white-screen the app in prod.
2. **Monolithic components** — `ChatTab.tsx` is 11,683 lines, `OfficeTab.tsx` 5,971, `RoomsTab.tsx` 5,403. They mix data loading, subscriptions, rendering, and business logic.
3. **Duplicated agent-resolution + polling logic** — FeedTab and OfficeTab each re-implement DB-agent + live-session merging; three different places store agent identity/themes.
4. **Bundle bloat from rarely used features** — `three`, `@react-three/fiber`, `@splinetool/*`, `postprocessing`, and the 3.5K-line `TradingBotPanel` ship in every bundle.
5. **Operational debt** — 5 Supabase migrations unmerged, 1 edge function undeployed (`room-task-executor`), zero unit tests, 13-subscription cleanup gap, unencrypted token storage on web.

None of this is fatal, but each issue taxes every new feature. Fix the P0 blockers this week, bank the high-leverage refactors the next two weeks, and the app will ship faster and stay stable as circles scale.

---

## 2. Current-State Snapshot (evidence)

| Area | Finding | Evidence |
|---|---|---|
| Component size | ChatTab 11,683 L · OfficeTab 5,971 L · RoomsTab 5,403 L · InteractiveFurniture 4,385 L · PixelAgent 3,802 L · TradingBotPanel 3,460 L | `wc -l src/**/*.tsx` |
| Deps | 38 production deps; heavy 3D stack (`three`, `@react-three/fiber`, `@splinetool/react-spline`, `@splinetool/runtime`, `postprocessing`) used only by `LoginBackground3D` | `package.json` |
| 3D usage | 3D libs imported only in login background | `src/components/LoginBackground3D.tsx` |
| Crypto | `ethers` + `@solana/web3.js` both in production bundle | `src/lib/crypto.ts:115, 295, 650` |
| Error boundaries | Only in `CircleDetailScreen.tsx:406, 491`, `BackpackTab.tsx:117`, `AgentPanelShell.tsx:580`. **None** on ChatTab/OfficeTab/FeedTab/RoomsTab | grep `getDerivedStateFromError` |
| Auth error handling | `supabase.auth.getUser()` called without `.catch()` in MorningRoutineScreen:47, WalletTab:25/66, ChallengesTab:51, CustomizePanel:253/277/293/312/366 | grep |
| Production localhost | `const bridgeUrl = \`http://localhost:${port}\`` with no env gate | `src/screens/circles/tabs/OfficeTab.tsx:232` |
| Subscriptions | 86 `.subscribe()` / 73 cleanups = ~13 unmatched | grep |
| Polling | 15 s memory refresh (AgentMemoryPanel:125); 1 s furniture clock (InteractiveFurniture:287); 30 s+ on others | grep `setInterval` |
| Pagination | 14 `.limit(...)`, **zero** `.range(...)` — no real pagination | grep |
| Hardcoded limits | `limit(50)` on challenges, members; `limit(30)` on missions | ChallengesTab:59/75, MembersTab:43/57, FeedTab:211 |
| Migrations unmerged | `20260225_office_cron_sweeper.sql`, `20260228_custom_themes.sql`, `20260301_agent_appearances.sql`, `20260301_office_layout.sql`, `20260318_pending_items.sql` | `supabase/migrations/` |
| Edge functions | `room-task-executor` written, **not deployed** | `supabase/functions/`, CLAUDE.md |
| Tests | 0 app-level tests; no test runner in `package.json` | — |
| Token storage | `expo-secure-store` on native, plaintext `localStorage` fallback on web | `src/lib/localSecrets.ts:12, 39, 48` |
| TS strictness | `strict: true` (inherits from `expo/tsconfig.base`); `~19` `any` usages (mostly navigation/metadata); zero `@ts-ignore` | `tsconfig.json` |

---

## 3. Priority Tiers

### P0 — Production blockers (this week, ~2–3 days total)

**P0-1. Fix Office production blank state**
- Problem: `OfficeTab.tsx:232` hard-codes `localhost:${port}` with no env fallback and no user-facing explanation.
- Action: (a) Gate local-bridge calls behind `__DEV__ || process.env.EXPO_PUBLIC_BRIDGE_URL`; (b) If no bridge URL, render an empty-state card that links to DEV.md setup rather than a silent "No agents". Optionally deploy the CORS proxy to Fly.io or Railway and set `EXPO_PUBLIC_BRIDGE_URL` in Netlify.
- Effort: 1–2 h for messaging fix; +4 h if deploying proxy.
- Impact: Unblocks Office for every non-local user.

**P0-2. Wrap every top-level tab in an ErrorBoundary**
- Problem: `ChatTab`, `OfficeTab`, `FeedTab`, `RoomsTab` have no error boundaries; one render error white-screens the whole app.
- Action: In `CircleDetailScreen.tsx` (or the tab navigator render), wrap each lazy tab with `<ErrorBoundary>` from `src/components/ErrorBoundary.tsx`. Add a top-level boundary in `App.tsx` as the last line of defense. Log to Supabase `app_errors` table for telemetry.
- Effort: 30–60 min.
- Impact: Resilience to every future regression.

**P0-3. Guard every `supabase.auth.getUser/getSession` call**
- Problem: Unhandled rejections (AbortError, network) crash components.
- Action: Introduce `src/lib/safeAuth.ts` with `getUserSafe()` returning `{ user: null, error }` and never throwing. Replace direct calls in MorningRoutineScreen:47, WalletTab:25/66, ChallengesTab:51, CustomizePanel:253/277/293/312/366, plus the other 4 sites grep surfaces.
- Effort: 1–2 h.
- Impact: Eliminates a common silent crash class.

**P0-4. Run the five pending Supabase migrations**
- Problem: Features referenced in code (custom themes, agent appearances, office layout, offline-agent sweeper, step-away sessions) have no schema.
- Action: In Supabase SQL Editor run in order: `20260225_office_cron_sweeper.sql`, `20260228_custom_themes.sql`, `20260301_agent_appearances.sql`, `20260301_office_layout.sql`, `20260318_pending_items.sql`. Verify RLS is `USING (auth.uid() = user_id)` or equivalent circle-membership check on each new table (per DATA_POLICY.md).
- Effort: 20–40 min.
- Impact: Unlocks shipped code; ends silent no-ops on theme/layout persistence.

**P0-5. Deploy `room-task-executor` edge function**
- Problem: Written, not deployed — room task automation silently idle.
- Action: `npx supabase functions deploy room-task-executor`; confirm the `pg_cron` schedule calls it; add a Grafana/Uptime probe if possible.
- Effort: 15 min.
- Impact: Activates room-level automation end-to-end.

### P1 — High-leverage refactors (weeks 1–2, ~4–6 engineering days)

**P1-1. Extract `useCircleAgents()` hook to deduplicate agent resolution**
- Problem: FeedTab:848–870 and OfficeTab duplicate the DB-agent × live-session merge (~30 L each, three different identity maps).
- Action: Create `src/hooks/useCircleAgents.ts` returning `{ agents, liveAgents, status }`. Own the merge, identity by `name.toLowerCase()`, and a stable sort. Replace both call sites.
- Effort: 2–3 h.
- Impact: Removes ~500 L net duplication; single source of truth for the agent list.

**P1-2. Split `ChatTab.tsx` (11,683 L) into a feature folder**
- Problem: Monolith mixes message rendering (inverted FlatList), slash commands, streamed research, task spawning, and agent invocation.
- Action: Create `src/screens/circles/tabs/chat/` with `ChatTab.tsx` (shell), `ChatMessageList.tsx`, `ChatComposer.tsx`, `ChatCommands.ts` (command registry), `ResearchPanel.tsx`, `useChatSubscriptions.ts`. Keep external imports stable by re-exporting from the old path during migration.
- Effort: 1.5–2 days.
- Impact: Faster iteration, easier code review, reduced re-render surface.

**P1-3. Split `OfficeTab.tsx` (5,971 L) similarly**
- Problem: Agent connectivity, floor state, customization, and realtime presence share one file and ~13 `useEffect`s.
- Action: `src/screens/circles/tabs/office/` with `OfficeTab.tsx` shell, `useOfficeConnectivity.ts` (bridge + OpenSwan + heartbeat + presence), `useFloorState.ts`, `OfficeCustomizer.tsx`, `OfficeFurniturePanel.tsx`. Move the hard-coded localhost here; centralize the `__DEV__` gate (ties into P0-1).
- Effort: 1–1.5 days.
- Impact: Makes Office testable; isolates prod-breakage risk.

**P1-4. Lazy-load TradingBotPanel, 3D libs, and other optional surfaces**
- Problem: `TradingBotPanel.tsx` (3,460 L) + `three`/`@react-three/fiber`/`@splinetool/*`/`postprocessing` ship on the critical path even for users who never see them.
- Action: (a) `const TradingBotPanel = React.lazy(() => import('./TradingBotPanel'))` gated behind the existing wallet/feature flag; (b) Same for `LoginBackground3D` — only import when the login screen mounts; (c) Audit `metro.config.js` for `transformer.minifierConfig` / `optimizationLevel: 2` on web builds.
- Effort: 3–5 h.
- Impact: Meaningfully smaller initial JS bundle on web; faster TTI on first load.

**P1-5. Consolidate agent identity + theme state**
- Problem: Custom names/colors live in `agentIdentity.ts` (AsyncStorage) + legacy `@office_agent_names` + Supabase `profiles.office_layout` + `user_custom_themes`. Three writers, race conditions.
- Action: Make Supabase the source of truth. AsyncStorage is a cache with TTL. Remove `@office_agent_names` legacy path. Add a single `agentIdentityStore` module with `get/set/subscribe` that writes through.
- Effort: 4–6 h.
- Impact: Ends "my theme reset itself" style bugs.

**P1-6. Paginate growth-prone lists**
- Problem: `.limit(50)` on challenges/members and `.limit(30)` on missions will silently truncate once a circle is active. Zero `.range()` in codebase.
- Action: Introduce a small `usePaginated(query, pageSize)` hook that wraps `.range(from, to)` with stable ordering. Convert MembersTab:43/57, ChallengesTab:59/75, FeedTab:211, GitHubTab:121 first.
- Effort: 4–6 h.
- Impact: Data correctness as circles grow; unlocks the upcoming search UX.

### P2 — Performance & hardening (weeks 3–4, ~3–4 days)

**P2-1. Virtualize message surfaces everywhere (confirm, not just ChatTab)**
- ChatTab already uses inverted `FlatList` ✓. Audit RoomsTab chat panel and OfficeChat to confirm virtualization. Convert any surviving `.map()` of messages to `FlatList` with `keyExtractor` + `getItemLayout` where heights are known.
- Effort: 2–4 h.

**P2-2. OpenSwan polling hygiene**
- Today: `OpenSwanPoller` loops ~2 s; AgentMemoryPanel refreshes every 15 s.
- Action: Base interval 30 s, exponential backoff on 429/5xx, poll-only-when-visible via `useIsFocused()`/`AppState`. AgentMemoryPanel → 30 s + manual refresh button.
- Effort: 3–4 h.
- Impact: ~2–3× fewer requests, lower model cost, better battery.

**P2-3. Subscription leak audit**
- 86 `.subscribe()` vs 73 cleanups. Grep for each `.subscribe(` without a nearby `removeChannel` in the same effect; wrap stragglers.
- Effort: 2–3 h.

**P2-4. Add DB indexes + cleanup jobs**
- Index `circle_office_agents(circle_id)`, `agent_activity(circle_id, created_at desc)`, `room_messages(room_id, created_at desc)`, `circle_github_events(circle_id, created_at desc)` if not already.
- Add a `pg_cron` weekly vacuum/delete on `agent_activity`, `office_terminal_messages` older than 30 days (follow `20260225_office_cron_sweeper.sql` pattern).
- Effort: 1–2 h.
- Impact: Keeps list queries fast as data grows.

**P2-5. RLS spot-check**
- Verify `circle_office_agents`, `agent_activity`, `room_messages`, `circle_memory` policies gate on `circle_members`. Remediate any leftover `USING (true)` from migrations.
- Effort: 2–3 h.

**P2-6. Secure token storage on web**
- Problem: `localSecrets.ts:39` writes tokens to plaintext `localStorage` on web.
- Action: Encrypt with a user-derived key (e.g., WebCrypto AES-GCM keyed off the Supabase access token) before writing. For highly sensitive tokens (OpenSwan gateway, Discord bot), move to a server-held secret via an edge function shim.
- Effort: 4–6 h.
- Impact: Defends against dev-tools + XSS token theft.

**P2-7. Confirmation dialogs on destructive actions**
- Delete circle, kick member, disconnect wallet, delete task, leave circle. Reuse an `AppAlert` / `ConfirmDialog` component; default cancel.
- Effort: 2–3 h.

**P2-8. First real tests**
- Install `vitest` + `@testing-library/react-native` (Expo-compatible). Target: (a) `useCircleAgents` merge logic, (b) `safeAuth` wrapper, (c) pagination hook, (d) a render smoke test per tab behind `ErrorBoundary`.
- Effort: 1 day to set up + 2 h per target.
- Impact: Regression safety before shipping anything user-visible.

### P3 — Polish & cleanup (opportunistic, 1–2 days scattered)

- Delete redundant planning docs called out in `PLAN_STATUS_AUDIT.md` (IMPLEMENTATION_ROADMAP.md, TODO_OFFICE.md, master-plan-addendum) to reduce cognitive load.
- Drop legacy `agent_bots` / old `agents` table references if still in the schema; confirm nothing queries them.
- Move `@napi-rs/canvas` from devDependencies → optional dev tooling (it's only for `scripts/generate-theme-sprites.js`).
- Replace remaining `any` in navigation props with the generated React Navigation types.
- Search-and-filter UX for circles/tasks/members (depends on P1-6 pagination).
- Offline cache layer (React Query persister + AsyncStorage) for Feed/Office reads; low-priority until mobile usage grows.
- Mobile Office UX (filters, sort, touch-optimized) — follow-up after P1-3 split.

---

## 4. Suggested Sequence (4-week plan)

### Week 1 — Stabilize production
Mon–Tue: P0-1 Office prod gating · P0-2 error boundaries · P0-3 safeAuth.
Wed: P0-4 run 5 migrations · P0-5 deploy `room-task-executor`.
Thu–Fri: P1-1 `useCircleAgents` hook · P1-6 `usePaginated` scaffolding + MembersTab conversion.

### Week 2 — Break up the monoliths
Mon–Wed: P1-2 Split ChatTab.
Thu: P1-3 Split OfficeTab (part 1 — extract connectivity hook).
Fri: P1-4 Lazy-load TradingBot + 3D.

### Week 3 — Performance + safety
Mon: P1-3 finish OfficeTab split · P1-5 agent identity consolidation.
Tue: P2-1 virtualization audit · P2-2 polling hygiene.
Wed: P2-3 subscription leak audit · P2-4 indexes + cleanup cron.
Thu: P2-5 RLS spot-check · P2-6 encrypted web token storage.
Fri: P2-7 confirmation dialogs · P2-8 test harness.

### Week 4 — Test, measure, clean
Mon–Tue: Write priority tests (hooks + pagination + auth wrapper).
Wed: Perf measurement pass — bundle-size diff, cold-start timing, Lighthouse for web, Supabase query stats.
Thu–Fri: P3 polish + buffer for any regression surfaced by tests.

---

## 5. Non-Goals (explicitly deferred)

- Rewriting the OpenSwan gateway tool loop (tracked in `OPENSWAN_ARCHITECTURE_AUDIT_2026-04-15.md`; large enough to be its own project).
- Wallet portfolio dashboard — decide between shipping or hiding before the refactor pass.
- Discord slash commands + event sync — gate behind `coming soon` flag until refactors land.
- Cloud-mode BlackSwan (Phase 2 in `NEXT_LEVEL_PLAN.md`) — unblocked by P0/P1 but a separate initiative.
- Trading bot — keep lazy-loaded; no functional work.

---

## 6. Measurement & success criteria

Before starting, capture baselines:

- **Bundle size:** `expo export --platform web` → record `dist/_expo/static/js/**/*.js` total + largest chunk.
- **Cold-start TTI (web):** Lighthouse run on Netlify preview.
- **Supabase:** Query latency p50/p95 on the five slowest endpoints (Office, Feed, Chat history).
- **Error rate:** Count of unhandled rejections per day (add a lightweight `onerror`/`onunhandledrejection` logger → `app_errors` table as part of P0-2).

Success targets after Week 4:

- 0 white-screen crashes in a 7-day production window.
- ≥ 25% reduction in initial web JS bundle (P1-4 + P1-2 should deliver this).
- ≥ 50% reduction in OpenSwan request volume (P2-2).
- All 5 pending migrations applied, `room-task-executor` healthy.
- ≥ 10 targeted tests covering merge/pagination/auth wrapper.

---

## 7. Risks

- **Refactor-induced regressions** — mitigated by the ErrorBoundary work (P0-2) landing first and by writing the priority tests (P2-8) before the big splits continue. Consider feature-flagging the split ChatTab behind a `CHAT_V2` flag during rollout.
- **Migration order** — some migrations add columns referenced by live code. Run them in the order listed in P0-4; if any fail, roll forward rather than revert (add a fix-forward migration).
- **Deploying the proxy publicly** (optional P0-1) — exposing the OpenSwan bridge to the internet expands attack surface. If chosen, put it behind Cloudflare Access or a signed-token middleware before the refactor.
- **Bundle changes breaking Expo web** — verify with a preview deploy after P1-4.

---

## 8. Open questions for you

1. Do you want to ship the wallet portfolio this cycle or hide the tab behind a flag until after the refactor?
2. Are you OK deploying the OpenSwan proxy publicly (Fly/Railway), or keep Office strictly local-only and fix only the messaging?
3. Preferred test runner — `vitest` (faster, modern) or `jest` (Expo default)?
4. Any surfaces you *don't* want touched in the 4-week window (e.g., Rooms is actively being iterated)?

---

*Prepared 2026-04-20. Revisit this doc at the end of each week — check off completed items, record baselines + after-numbers in §6, add newly discovered issues at the bottom of the relevant tier.*

---

## 9. Completed in pass 1 (2026-04-20)

First execution pass. Every change below ships with a clean `npx tsc --noEmit --skipLibCheck` run.

### P0 — production blockers

- **P0-1: Office localhost gated in production.**
  - New `src/lib/bridgeEnvironment.ts` — decides whether local-CLI bridges (Claude Code, Codex, Gemini, Cursor, OpenSwan) are reachable, based on `Platform`, `__DEV__`, hostname, and an `EXPO_PUBLIC_BRIDGE_HOST` override. `localStorage['uc_force_bridges'] === '1'` opts in on prod web for advanced users.
  - `src/lib/agentAutoConnect.ts:259` short-circuits `startAgentAutoConnect()` when bridges aren't available — no more 20s retry loops hammering localhost in prod.
  - `src/screens/circles/tabs/OfficeTab.tsx:243` replaces the hard-coded `http://localhost:${port}` with `getBridgeUrl(port)`; returns a clear error string ("Agent bridges are only reachable from the local dev machine…") instead of a silent timeout.
  - New `BridgeUnavailableBanner` component rendered near the top of Office — explains *why* the list is empty and points to `npm run dev` / `EXPO_PUBLIC_BRIDGE_HOST`. Dismissible.
- **P0-2: Error boundaries normalised.**
  - Audit finding was wrong on coverage — `CircleDetailScreen.tsx:491` (LazyTab) and `App.tsx:368` already wrap every tab + the whole app. Redundant explicit Office wrap removed.
  - `ErrorBoundary.tsx` rewritten to the UC style guide (GitHub dark palette, indigo primary, no emoji). Added `scope` prop — each tab now reports its name (`ErrorBoundary scope={`${tabKey} tab`}`) and the top-level boundary uses `scope="app"`. Last error captured at `window.__uc_last_boundary_error` for quick support inspection.
- **P0-3: `safeAuth` wrapper + 14 call-site migrations.**
  - `src/lib/authSession.ts` extended with `safeGetUser()`, `safeGetSession()`, `safeGetUserId()`. Never throw; return `{ value, error }`.
  - Migrated: `WalletTab.tsx` (×2), `ChallengesTab.tsx`, `MembersTab.tsx`, `DigestTab.tsx`, `CustomizePanel.tsx` (×5), `ProfileScreen.tsx`, `EditProfileScreen.tsx` (×2), `CheckInScreen.tsx` (×2), `CreateCircleScreen.tsx`, `CircleSettingsScreen.tsx`. Remaining ~50 unguarded sites are in internal libs / OfficeTab / RoomsTab — they'll get cleaned up during the P1 splits.

### P1 — high-leverage refactors

- **P1-1: `useCircleAgents` → `useAutoConnectLiveAgents` hook.**
  - `src/hooks/useAutoConnectLiveAgents.ts` — owns the session-to-`OfficeAgent` conversion, identity/custom-name/color resolution, and `CircleOfficeAgent` mapping. Also exports `mergeDbAndLiveCircleAgents()` for DB×live merging.
  - `FeedTab.tsx` shrunk by ~100 lines; drops five direct imports from `agentAutoConnect` / `officeAgents` / `agentIdentity` / `storage`. OfficeTab's bespoke `buildOfficeRoster` pipeline left alone (different, richer use case).
- **P1-4: Lazy-load heavy panels + 3D.**
  - `BackpackTab.tsx`: `TradingBotPanel` (3,460 L), `ModelLabPanel`, `LLMBenchmarkPanel`, `PixelOfficeCanvas` now `React.lazy` with a shared `CompartmentSuspenseFallback`. Only loads when the user taps the relevant compartment.
  - `LoginScreen.tsx`: `LoginBackground3D` (pulls `three`, `@react-three/fiber`, `@react-three/postprocessing`) now `React.lazy` behind `Platform.OS === 'web'` guard + `Suspense fallback={null}` so the login form paints immediately.
- **P1-6: `usePaginated` hook + two conversions.**
  - `src/hooks/usePaginated.ts` — generic, query-shape-agnostic pagination with stable-key reset, stale-response cancellation via `generationRef`, and `loading` / `loadingMore` separation. Pairs cleanly with Supabase `.range(from, to)` but doesn't depend on it.
  - `MembersTab.tsx` converted: `.limit(50)` → `.range()` pagination; `onEndReached` loads more; header count shows `N+` when more remain; preserves check-in overlay and sort order.
  - `ChallengesTab.tsx` converted: challenges paginate; participants still fetched for every visible page via a derived effect.

### P2 — performance hygiene

- **P2-2: Polling cadence relaxed.**
  - `agentAutoConnect.ts`: introduced `BRIDGE_POLL_INTERVAL_MS = 10000`. Claude Code / Codex / Gemini / Cursor pollers moved from 5s → 10s. Halves local HTTP request volume; OpenSwan poller already on 20s.
  - `AgentMemoryPanel.tsx:125`, `OfficeTerminal.tsx:882`, `AgentControlCard.tsx:109`, `AgentOverviewPanel.tsx:435`: all 15s intervals → 30s. Realtime subscriptions are primary; these are belt-and-suspenders refreshes.

### Guardrail work (not a plan item but worth noting)

- `.claude/projects/-Users-cswanson/memory/MEMORY.md` style-guide index line corrected — the "Black & White Terminal" wording was stale vs `feedback_style_guide.md` which already described the rounded-dark-plus-accents system (which itself matches `docs/UC_STYLE_GUIDE.md`).
- No emoji added to any new UI (ErrorBoundary, BridgeUnavailableBanner) per `feedback_emoji_discipline` memory.

### Still pending (touch these next)

- **P0-4:** Run the five Supabase migrations (`20260225_office_cron_sweeper.sql`, `20260228_custom_themes.sql`, `20260301_agent_appearances.sql`, `20260301_office_layout.sql`, `20260318_pending_items.sql`). Requires your Supabase SQL Editor — not safe to auto-run.
- **P0-5:** `npx supabase functions deploy room-task-executor`. Requires your CLI login.
- **P1-2:** Split `ChatTab.tsx` (11,683 L).
- **P1-3:** Split `OfficeTab.tsx` (5,971 L) — adopt `useAutoConnectLiveAgents` during the split.
- **P1-5:** Consolidate agent identity stores.
- **P2-1:** Virtualization audit on RoomsTab + OfficeChat.
- **P2-3:** Full subscription-leak audit (86 vs 73).
- **P2-4:** DB indexes + cleanup crons.
- **P2-5:** RLS spot-check.
- **P2-6:** Encrypted web token storage.
- **P2-7:** Confirmation dialogs on destructive actions.
- **P2-8:** First real tests — `useAutoConnectLiveAgents.mergeDbAndLiveCircleAgents`, `safeGetUser`, `usePaginated` are the first three that deserve tests now that they're shared utilities.

### Verification notes

- `npx tsc --noEmit --skipLibCheck` was clean after every batch of edits.
- Running dev server at `localhost:8082` returns 200 on `/`. A stale Metro resolver issue on `src/lib/profileNavigation.ts` (a root-owned untracked file predating this session) blocks the web bundle until the dev server is restarted — unrelated to anything changed here.

---

## 10. Pass 2 (2026-04-21)

Continuation. Typecheck clean after every change.

### P2-4 — Pending SQL consolidated (needs you to run)

- `docs/RUN_THIS_SQL.sql` — single, idempotent script that bundles the five pending migrations (`20260228_custom_themes`, `20260301_agent_appearances`, `20260301_office_layout`, `20260225_office_cron_sweeper` + `20260318_pending_items`) plus the P2-4 indexes and cleanup crons. Every statement uses `IF NOT EXISTS`, `OR REPLACE`, or `DROP POLICY IF EXISTS` so re-runs are safe.
- Adds: `idx_circle_office_agents_circle_id`, `idx_agent_activity_circle_created`, `idx_room_messages_room_created`, `idx_circle_github_events_circle_created`, `idx_check_ins_circle_created`, `idx_challenge_participants_challenge`.
- Adds daily `cleanup_old_agent_activity` and `cleanup_old_office_terminal_messages` pg_cron jobs (30-day retention).
- Also provides a defensive `CREATE OR REPLACE FUNCTION get_my_circle_ids()` so a fresh DB can apply without a prior migration chain.
- **Action for you:** paste into Supabase SQL Editor. Verification queries are at the bottom of the file.

### Global unhandled-rejection logger

- `src/lib/errorReporter.ts` — installs `window.unhandledrejection` + `window.error` listeners on web; tags transient AbortErrors from bounded Supabase Web Lock waits as benign; keeps a 25-entry ring buffer plus `window.__uc_last_global_error` for DevTools inspection. No-op on native runtimes.
- Wired from `App.tsx:2` so it's active before any app code runs. `reportError(err, tag)` available for manual capture.

### P2-7 — Confirmation dialogs on destructive actions

- `src/lib/alert.ts` — added promise-based `showConfirm({ title, message, confirmLabel, cancelLabel, destructive })` that bridges web `window.confirm` and native `Alert.alert` with a destructive button style.
- Wired to:
  - `CircleSettingsScreen.handleDeleteCircle` and `handleLeaveCircle` (removed legacy "tap twice" `deleteConfirm` / `leaveConfirm` state).
  - `WalletTab.handleDisconnect`.
  - `CustomizePanel.handleDeleteCustomTheme`.
  - `MissionsTab.handleDeleteTask`.
- `TaskDetailModal`'s existing two-step "Confirm delete" flow left alone — it's already protected with a visible warning.

### Still pending after pass 2

- **P0-5:** `npx supabase functions deploy room-task-executor` (needs your CLI login).
- **P1-2:** Split `ChatTab.tsx` (11,683 L).
- **P1-3:** Split `OfficeTab.tsx` (5,971 L) — adopt `useAutoConnectLiveAgents` during the split.
- **P1-5:** Consolidate agent identity stores.
- **P2-1:** Virtualization audit on RoomsTab + OfficeChat.
- **P2-3:** Full subscription-leak audit (86 vs 73).
- **P2-5:** RLS spot-check.
- **P2-6:** Encrypted web token storage.
- **P2-8:** First real tests (`mergeDbAndLiveCircleAgents`, `safeGetUser`, `usePaginated`).

### Verification notes

- `npx tsc --noEmit --skipLibCheck` clean.
- Pre-existing Metro bundle issue (`profileNavigation.ts`) still present; requires a dev-server restart to clear.

---

## 11. Pass 3 (2026-04-21)

Continuation. Typecheck clean after every change.

### P2-3 — Subscription leak audit

- Audited every `supabase.channel(` call across `src/` (via an Explore agent sweep). No active production leaks found.
- The initial `86 vs 73` number was counting every `.subscribe(` literal (incl. RxJS-style observers and custom subscribers). True Supabase channel count is ~18 in the high-risk files, all correctly paired with `removeChannel` in cleanup paths.
- Noted `src/lib/officeTerminal.ts:563` uses a module-level `commandChannels` Map for connection reuse. Safe as-is — the public API (`subscribeToTerminalCommands`) always pairs with `cleanupTerminalChannels`. Worth a comment if revisited.

### P2-1 — Virtualization audit + two conversions

- `src/screens/circles/tabs/RoomsTab.tsx:2889` — the big one. Room chat was a `ScrollView` + `messages.map()` rendering every bubble. Converted to `FlatList` with `initialNumToRender={40}`, `windowSize={10}`, `maxToRenderPerBatch={20}`, `removeClippedSubviews`. `scrollRef` retyped `useRef<FlatList<RoomMessage>>` — `scrollToEnd` API is shared so the two existing call-sites work unchanged. Item spacing moved from `gap: 6` on contentContainerStyle to `ItemSeparatorComponent`.
- `src/screens/circles/tabs/rooms/RoomChatView.tsx:180` — same pattern. Converted; typing indicator moved to `ListFooterComponent`; message body extracted to a memoized `RenderRoomChatMessage` (React.memo) so per-row re-renders only fire when that row's `msg` prop changes.
- Reviewed and skipped (naturally small lists): `PhoneMessenger.tsx` (toy demo), `SharedMemoryPanel` history, `AutomationsPanel` runs, `TaskDetailModal` comments.

### P2-6 — Encrypted web token storage

- New `src/lib/webCrypto.ts` — AES-GCM 256 helper using WebCrypto. Key is generated once and stashed in IndexedDB under `uc_crypto_v1.keys.local_secret_key`, never in localStorage. Ciphertext format: `v1:${base64(iv)}:${base64(ciphertext)}`.
- `src/lib/localSecrets.ts` rewritten on the web path: reads detect the `v1:` prefix and decrypt; writes encrypt if SubtleCrypto + IndexedDB are available, else fall back to plaintext so ancient browsers still work. Legacy plaintext blobs remain readable (`isEncryptedBlob` returns false → returned as-is) and get transparently upgraded on the next write.
- Does NOT defeat targeted XSS (attacker running on the page can still pull the key from IDB and decrypt), but does defeat the common extension / devtools snippet that greps localStorage for "token"-looking strings.

### Still pending after pass 3

- **P0-5:** `npx supabase functions deploy room-task-executor` (needs your CLI login).
- **P1-2:** Split `ChatTab.tsx` (11,683 L).
- **P1-3:** Split `OfficeTab.tsx` (5,971 L).
- **P1-5:** Consolidate agent identity stores.
- **P2-5:** RLS spot-check.
- **P2-8:** First real tests.

### Verification notes

- `npx tsc --noEmit --skipLibCheck` clean after each batch.
- Pre-existing Metro bundle error on `src/lib/profileNavigation.ts` still unresolved; dev-server restart required.
