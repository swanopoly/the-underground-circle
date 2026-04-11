# The Underground Circle — Next Level Plan
**Created:** 2026-04-10
**Author:** Swan + Claude
**Status:** Active — implementation in progress

---

## Where We Are Now

The app has an enormous amount of functionality — 20+ tabs, pixel art offices, AI agents, crypto wallets, trading bots, schools, wiki, organizations, games, and more. The technical foundation is solid (Supabase, Expo, TypeScript, real-time presence, agent connectivity).

Three problems are keeping it from breaking through:

1. **The core loop has too much friction** — Circle → GitHub → Agents Work → Team Sees Results → Accountability. Every step has gaps.
2. **Feature sprawl dilutes the story** — A new user lands and faces 20+ surfaces competing for attention. There's no clear "aha moment" in the first 60 seconds.
3. **The differentiator (Office) doesn't work on production** — The best feature requires localhost setup, so the live site can't show what makes UC special.

## The Strategic Thesis

> **"An AI-native accountability OS where people and agents pursue shared goals together, with visible proof-of-work, live coordination, and incentives."**

Not "another AI chat." Not "another community app." The loop of **missions → agent execution → visible proof → social accountability → incentives** is what no one else has.

---

## Phase 0: Foundation (Week 1-2)
**"Make what exists work flawlessly before adding anything new"**

### 0.1 — Run all pending migrations
- `20260318_pending_items.sql` (pg_cron sweeper + step_away_sessions)
- `20260228_custom_themes.sql`
- `20260301_agent_appearances.sql`
- `20260301_office_layout.sql`
- `20260408_unified_agent_runs.sql`

### 0.2 — Deploy pending edge functions
- `automation-executor`
- `room-task-executor`
- Redeploy `swanbot-ai` with latest changes

### 0.3 — Hide/gate unfinished features
Features that are half-built hurt more than they help. Gate these behind a feature flag or remove from nav:
- **Trading bot** (TradingBotPanel — 150K lines, not core)
- **Photon proof** (not implemented)
- **DMs** (referenced but no UI)
- **Wallet dashboard** (connect works, portfolio doesn't)
- **LLM Benchmarks** (dev tool, not user-facing)
- **Scrabble/poker games** (fun but distracting from core)

### 0.4 — Production reliability
- Error boundaries on every tab (CircleDetail wraps each tab)
- `.catch()` audit on all Supabase calls
- Loading states on all network actions
- Confirmation dialogs on destructive actions (leave circle, delete, kick)

### 0.5 — Security hardening
- Move API keys to edge functions (GEMINI_API_KEY out of client)
- Encrypt tokens in localStorage (or use expo-secure-store)
- Input validation on all user-generated content
- Rate limiting on message/task creation

---

## Phase 1: The Mission Loop (Week 3-5)
**"The one feature that makes everything else make sense"**

This is the single highest-leverage thing to build. Right now, circles are containers for chat. They need to become **mission-driven teams**.

### 1.1 — Circle Missions
New `circle_missions` table + UI:
```
Mission: "Ship v2 landing page by Friday"
Owner: @swan
Agents: BlackSwan (monitor), C3PO (code)
Status: In Progress (3/5 tasks done)
Deadline: April 18
Evidence: 4 commits, 2 PRs merged
```

- Create/edit missions with title, description, deadline, owner
- Assign human members + agents to missions
- Sub-tasks that map to agent runs
- Status auto-updates from GitHub events + agent completions
- BlackSwan generates weekly mission reports

### 1.2 — Proof-of-Work Feed
Transform the Feed tab from a task list into a **mission ledger**:
- Every agent run generates a structured feed entry (what was asked → what was done → what changed)
- GitHub events become feed entries (commits, PRs, deploys)
- Check-ins link to missions ("I worked on X today")
- Feed becomes the social proof layer — visible to the whole circle

### 1.3 — Mission Templates
Pre-built mission structures for common circle types:
- **Dev Sprint** — weekly sprint with GitHub tracking, daily standups via BlackSwan
- **Content Push** — content creation pipeline with research → draft → review → publish
- **Launch Prep** — checklist-driven with deploy monitoring
- **Study Group** — reading assignments, discussion prompts, quiz challenges

### 1.4 — BlackSwan as Mission Tracker
Upgrade BlackSwan from "chat bot" to "mission intelligence":
- Daily standup summary (who shipped what, who's blocked)
- Nudge inactive members with specific context ("You haven't pushed to the landing-page branch in 3 days")
- Celebrate completions ("Mission complete! 5 PRs merged, shipped 2 days early")
- Weekly direction session (auto-generated retrospective)

---

## Phase 2: Agent Intelligence (Week 6-8)
**"Agents that produce visible, valuable work on production"**

### 2.1 — BlackSwan Cloud Mode
Solve the production problem. BlackSwan should work **without localhost**:
- BlackSwan edge function already works (swanbot-ai)
- Make it the default agent for every circle on production
- Scheduled background tasks via pg_cron (daily summary, weekly report)
- No local setup required — value from day 1

### 2.2 — Agent Task Queue
Visual task queue that any circle member can fill:
- "Research competitors in our space" → BlackSwan picks it up
- "Review this PR for security issues" → Routed to appropriate agent
- Task status visible to whole circle (pending → running → done)
- Results posted to Proof-of-Work feed

### 2.3 — Agent Reputation
Track per-agent performance across runs:
- Completion rate, avg response time, cost per task
- Reliability score (S/A/B/C/D tiers)
- Specialization tags (auto-detected from task history)
- Visible in Office as reputation badges on pixel agents

### 2.4 — Smart Routing
When a task comes in, suggest the best agent:
- Match task description to agent specializations
- Consider current load, cost, and reliability
- "This looks like a code review — route to C3PO (98% completion rate, avg $0.12/task)?"

---

## Phase 3: User Acquisition (Week 9-11)
**"Make it irresistible to try and impossible to leave"**

### 3.1 — 60-Second Onboarding
Redesign onboarding to deliver value fast:
1. Sign up (10s)
2. Create or join a circle (15s)
3. Connect GitHub repo (20s) — OAuth, one click
4. BlackSwan posts first insight ("I see 3 open PRs and a failing CI build") (15s)
5. Create first mission from template (10s)

### 3.2 — Landing Page
Public marketing site at chrisswanson.xyz:
- Hero: demo video of the Office + mission loop
- Three value props: "Track what matters", "Agents that work", "Proof you shipped"
- Live circle activity feed (anonymized) showing real usage
- Waitlist + direct sign-up

### 3.3 — Push Notifications
Critical for retention (expo-notifications already installed):
- Mission deadline approaching
- Agent completed a task (with result summary)
- Someone in your circle shipped
- Streak about to break
- BlackSwan weekly report ready

### 3.4 — Invite Virality
The invite system exists but needs juice:
- "Invite 3 friends, unlock Pro features for a month"
- Circle discovery (public circles you can browse and join)
- Shareable mission cards ("Join our circle — we're building X")
- Referral tracking

---

## Phase 4: Revenue (Week 12-14)
**"Get to $10K MRR"**

### 4.1 — Pricing Tiers
- **Free**: 1 circle, 3 members, BlackSwan basic, 7 days history
- **Pro ($20/mo)**: Unlimited circles, 10 members, full analytics, 90 days history, custom themes
- **Team ($49/mo)**: 25 members, agent workflows, priority BlackSwan, data export, SSO
- **Enterprise (custom)**: Unlimited everything, audit logs, SLA, dedicated support

### 4.2 — Stripe Integration
- Billing per organization
- Usage metering for agent compute (tokens used)
- Upgrade prompts at natural friction points ("You've hit 3 circles — upgrade for unlimited")

### 4.3 — Enterprise Features
The org screens already exist. Wire them up:
- SSO/SAML (SSOConfigScreen exists, needs backend)
- Audit logs (agent_run_steps table already tracks everything)
- Data export (CSV/JSON of missions, runs, costs)
- White-label (WhiteLabelScreen exists, needs backend)

---

## Phase 5: Network Effects (Month 4+)
**"From product to platform"**

### 5.1 — Cross-Circle Agent Reputation
Agents gain reputation that travels across circles:
- "Top research agent in 12 founder circles"
- "99.5% reliability across 500+ tasks"
- Creates demand for good agents → marketplace potential

### 5.2 — Wallet-Native Bounties
Connect crypto to the mission loop:
- Post a bounty on a mission ("$50 SOL for whoever ships the API endpoint")
- Automatic payout on mission completion (verified by agent)
- Circle treasury for shared funds
- This is where crypto stops being decorative and becomes functional

### 5.3 — Template Marketplace
- Community-submitted circle templates, mission templates, agent configs
- Featured templates by category (dev, creator, student, fitness)
- Revenue share for template creators

### 5.4 — Public API + SDK
- REST API for programmatic circle/mission management
- Webhook callbacks for mission events
- Agent SDK for building custom agents that plug into UC
- CLI tool: `uc deploy agent research-bot.yaml`

---

## What To Cut (Permanently or Indefinitely)

Be ruthless. Every feature you keep is attention you can't spend on the core loop:

| Feature | Verdict | Why |
|---------|---------|-----|
| Trading bot | **Cut** | 150K lines, completely off-thesis |
| Scrabble/Poker | **Cut** | Fun but no one opens UC to play Scrabble |
| LLM Benchmarks | **Hide** | Dev tool, not user value |
| Photon Proof | **Cut** | Never implemented |
| Wiki (188K lines) | **Defer** | Huge investment, not in core loop yet |
| Schools (421K data) | **Defer** | Interesting but premature |
| Device Panel | **Defer** | Not core |
| Retro Emulator | **Cut** | Cool tech demo, not product |
| 3D Login Background | **Simplify** | 148K lines for a login screen is too heavy |

---

## Priority Summary

| Priority | What | Why | When |
|----------|------|-----|------|
| **P0** | Foundation fixes | Nothing else matters if the app crashes | Week 1-2 |
| **P1** | Circle Missions + Proof-of-Work Feed | This IS the product | Week 3-5 |
| **P2** | BlackSwan Cloud + Agent Tasks | Differentiator must work on production | Week 6-8 |
| **P3** | Onboarding + Landing Page + Notifications | Can't grow without acquisition + retention | Week 9-11 |
| **P4** | Pricing + Stripe | Revenue validates product-market fit | Week 12-14 |

---

## Implementation Notes

### Database Tables Needed (Phase 1)
```sql
-- circle_missions
create table circle_missions (
  id uuid primary key default gen_random_uuid(),
  circle_id uuid references circles(id) on delete cascade,
  title text not null,
  description text,
  owner_id uuid references auth.users(id),
  status text check (status in ('draft','active','completed','archived')) default 'active',
  deadline timestamptz,
  template_id text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- mission_tasks (sub-tasks within a mission)
create table mission_tasks (
  id uuid primary key default gen_random_uuid(),
  mission_id uuid references circle_missions(id) on delete cascade,
  title text not null,
  assignee_id uuid references auth.users(id),
  agent_name text,
  status text check (status in ('pending','in_progress','done','blocked')) default 'pending',
  evidence jsonb default '[]',
  created_at timestamptz default now(),
  completed_at timestamptz
);

-- mission_agents (agents assigned to missions)
create table mission_agents (
  id uuid primary key default gen_random_uuid(),
  mission_id uuid references circle_missions(id) on delete cascade,
  agent_name text not null,
  role text, -- 'monitor', 'executor', 'reviewer'
  assigned_at timestamptz default now()
);

-- proof_of_work (feed entries generated by missions)
create table proof_of_work (
  id uuid primary key default gen_random_uuid(),
  circle_id uuid references circles(id) on delete cascade,
  mission_id uuid references circle_missions(id),
  user_id uuid references auth.users(id),
  agent_name text,
  pow_type text check (pow_type in ('commit','pr','deploy','agent_run','checkin','manual')),
  title text not null,
  detail jsonb default '{}',
  created_at timestamptz default now()
);

-- RLS policies
alter table circle_missions enable row level security;
alter table mission_tasks enable row level security;
alter table mission_agents enable row level security;
alter table proof_of_work enable row level security;

create policy "Circle members can view missions"
  on circle_missions for select using (
    circle_id in (select circle_id from circle_members where user_id = auth.uid())
  );

create policy "Circle members can create missions"
  on circle_missions for insert with check (
    circle_id in (select circle_id from circle_members where user_id = auth.uid())
  );

create policy "Mission owner can update"
  on circle_missions for update using (owner_id = auth.uid());

create policy "Circle members can view tasks"
  on mission_tasks for select using (
    mission_id in (
      select id from circle_missions where circle_id in (
        select circle_id from circle_members where user_id = auth.uid()
      )
    )
  );

create policy "Circle members can manage tasks"
  on mission_tasks for all using (
    mission_id in (
      select id from circle_missions where circle_id in (
        select circle_id from circle_members where user_id = auth.uid()
      )
    )
  );

create policy "Circle members can view agents"
  on mission_agents for select using (
    mission_id in (
      select id from circle_missions where circle_id in (
        select circle_id from circle_members where user_id = auth.uid()
      )
    )
  );

create policy "Circle members can view proof"
  on proof_of_work for select using (
    circle_id in (select circle_id from circle_members where user_id = auth.uid())
  );

create policy "Circle members can create proof"
  on proof_of_work for insert with check (
    circle_id in (select circle_id from circle_members where user_id = auth.uid())
  );
```

### Files To Create (Phase 1)
- `src/lib/missions.ts` — CRUD + realtime subscriptions for missions
- `src/lib/proofOfWork.ts` — Feed generation from agent runs + GitHub events
- `src/components/MissionCard.tsx` — Mission display card with progress
- `src/components/MissionEditor.tsx` — Create/edit mission modal
- `src/components/MissionTemplates.tsx` — Template picker
- `src/screens/circles/tabs/MissionsTab.tsx` — Main missions view (replaces or augments FeedTab)

### Files To Modify (Phase 0)
- `src/screens/circles/CircleDetailScreen.tsx` — Error boundaries, feature gates
- `src/navigation/MainNavigator.tsx` — Remove/hide gated screens
- `App.tsx` — Global error boundary already exists, verify wrapping
- All Supabase call sites — `.catch()` audit
