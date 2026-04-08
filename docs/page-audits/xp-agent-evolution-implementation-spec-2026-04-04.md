# XP + Agent Evolution Implementation Spec

Date: 2026-04-04
Repo: `the-underground-circle`
Depends on: `xp-agent-evolution-deep-audit-2026-04-04.md`
Goal: give Claude an execution-ready spec for unifying progression and making agent evolution visible, fun, and extensible

## Product goal

Turn progression into a coherent three-layer system:

1. `User XP`
2. `Bond XP`
3. `Mastery XP`

And make that progression visible through:

- better feedback
- clearer ledgers
- milestone reveals
- agent evolution states
- specialization branches

## Non-goals for PR1

Do not attempt all of this in the first pass:

- no full rework of all legacy rewards
- no total removal of `user_points`
- no fully procedural trait generation
- no cinematic-heavy animation pass
- no complete rebalance of every historical reward source

PR1 should create the progression backbone and the first visible UX wins.

## Target model

### Canonical progression meanings

#### User XP

Tracks the human player’s account-level progress.

Use for:

- profile level
- titles
- season ladders
- broad progression summaries

#### Bond XP

Tracks relationship depth with a single agent.

Use for:

- bond level
- relationship title
- memory depth
- personalization unlocks
- aura/pet/form evolution

#### Mastery XP

Tracks capability growth in a specific agent specialty.

Use for:

- spirit progression
- behavior unlocks
- workflow/tool unlocks
- role promotions

## Data model

### Keep these existing tables

- `user_xp`
- `xp_events`
- `user_points`
- `points_transactions`
- `user_badges`
- `agent_bonds`

### Add these new tables

#### `progression_events`

Purpose:

- canonical analytics and balancing ledger
- one record per meaningful progression event
- lets existing reward systems coexist while migration happens

Suggested schema:

```sql
create table if not exists progression_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  circle_id uuid references circles(id) on delete cascade,
  agent_bond_id uuid references agent_bonds(id) on delete cascade,
  source_table text,
  source_id uuid,
  session_key text,
  event_family text not null check (
    event_family in (
      'user_xp',
      'bond_xp',
      'mastery_xp',
      'points',
      'achievement',
      'unlock',
      'quest'
    )
  ),
  event_type text not null,
  amount int not null default 0,
  quality_score numeric(5,2),
  combo_key text,
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create index if not exists idx_progression_events_user_created
  on progression_events(user_id, created_at desc);

create index if not exists idx_progression_events_bond_created
  on progression_events(agent_bond_id, created_at desc);

create index if not exists idx_progression_events_family_type
  on progression_events(event_family, event_type);
```

#### `agent_mastery`

Purpose:

- one row per bond per active specialty track
- allows an agent to grow in a spirit lane

Suggested schema:

```sql
create table if not exists agent_mastery (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  circle_id uuid not null references circles(id) on delete cascade,
  agent_bond_id uuid not null references agent_bonds(id) on delete cascade,
  spirit_id text not null,
  mastery_xp int not null default 0,
  mastery_level int not null default 1,
  success_count int not null default 0,
  failure_count int not null default 0,
  quality_score_avg numeric(5,2) not null default 0,
  last_promoted_at timestamptz,
  unlocked_nodes jsonb not null default '[]',
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(agent_bond_id, spirit_id)
);

create index if not exists idx_agent_mastery_bond
  on agent_mastery(agent_bond_id);
```

#### `agent_evolution_unlocks`

Purpose:

- durable record of what an agent unlocked and why

Suggested schema:

```sql
create table if not exists agent_evolution_unlocks (
  id uuid primary key default gen_random_uuid(),
  agent_bond_id uuid not null references agent_bonds(id) on delete cascade,
  unlock_type text not null check (
    unlock_type in (
      'memory_depth',
      'appearance',
      'aura',
      'pet_stage',
      'voice_style',
      'initiative_mode',
      'workflow_pack',
      'spirit_branch',
      'role'
    )
  ),
  unlock_key text not null,
  source_family text not null check (
    source_family in ('bond', 'mastery', 'quest', 'achievement', 'manual')
  ),
  source_level int,
  metadata jsonb not null default '{}',
  granted_at timestamptz not null default now(),
  unique(agent_bond_id, unlock_type, unlock_key)
);

create index if not exists idx_agent_evolution_unlocks_bond
  on agent_evolution_unlocks(agent_bond_id, granted_at desc);
```

#### `agent_progression_snapshots`

Purpose:

- powers session-end summaries without recomputing deltas from all time

Suggested schema:

```sql
create table if not exists agent_progression_snapshots (
  id uuid primary key default gen_random_uuid(),
  agent_bond_id uuid not null references agent_bonds(id) on delete cascade,
  session_key text,
  bond_xp_before int not null default 0,
  bond_xp_after int not null default 0,
  bond_level_before int not null default 1,
  bond_level_after int not null default 1,
  mastery_before jsonb not null default '{}',
  mastery_after jsonb not null default '{}',
  user_xp_earned int not null default 0,
  points_earned int not null default 0,
  summary jsonb not null default '{}',
  created_at timestamptz not null default now()
);
```

## RLS

Apply same ownership model as current reward tables.

Rules:

- user can read and write only their own progression rows
- optional read-all only for explicit leaderboard or social views
- `progression_events` should default to owner-only reads unless a public feed is intentionally designed

## Migration strategy

### PR1 migration philosophy

Do not rewrite historical XP tables immediately.

Instead:

1. add new tables
2. start dual-writing new progression events
3. surface new UI from new tables first
4. migrate old analytics and balancing later

### Existing function mapping

#### `awardXP(...)`

Keep current behavior.

Also add:

- insert into `progression_events` with `event_family='user_xp'`

#### `awardPoints(...)`

Keep current behavior.

Also add:

- insert into `progression_events` with `event_family='points'`

#### `awardBondXP(...)`

Expand behavior.

Also add:

- insert into `progression_events` with `event_family='bond_xp'`
- evaluate unlock thresholds
- optionally write snapshot summary when attached to an active session

#### New `awardMasteryXP(...)`

Add new service/RPC.

Use for:

- successful spirit-specific work
- challenge completions
- streaks in a role lane

Also add:

- insert into `progression_events` with `event_family='mastery_xp'`

## Reward formulas

### User XP

Keep existing values for PR1 unless a callsite is clearly broken.

Add one rule:

- stop treating Office turns as implicit account-level XP through opaque sync logic

Recommendation:

- preserve current `user_points` behavior for continuity
- do not introduce new sync rules from points into user XP
- mark the current `sync_points_to_xp()` path as legacy and schedule removal later

### Bond XP base rewards

Recommended base table:

```ts
export const BOND_XP_V2 = {
  session_started: 5,
  message_sent: 2,
  meaningful_reply: 4,
  task_completed: 12,
  user_feedback_positive: 10,
  long_session: 15,
  customization_saved: 12,
  name_given: 25,
  daily_interaction: 8,
  streak_day: 5,
  trust_escalation: 18,
  milestone_reached: 40,
} as const;
```

Notes:

- `message_sent` stays small to reduce spam incentives
- outcome and trust events are more valuable than raw chatting
- feedback and sustained use matter more than single-click actions

### Mastery XP base rewards

Recommended base table:

```ts
export const MASTERY_XP_V1 = {
  successful_turn: 3,
  successful_task: 15,
  user_accepted_output: 10,
  user_reused_artifact: 12,
  high_quality_rating: 15,
  streak_same_spirit_day: 8,
  challenge_completed: 25,
  role_promotion: 40,
} as const;
```

### Quality multipliers

Avoid binary reward logic.

Recommended multipliers:

```ts
const QUALITY_MULTIPLIER = {
  low: 0.75,
  normal: 1,
  high: 1.25,
  exceptional: 1.5,
} as const;
```

Quality sources can be:

- explicit thumbs-up
- user accepts suggested task/output
- artifact reused or shared
- workflow completes end-to-end

### Combo bonuses

Suggested starter combos:

```ts
export const XP_COMBOS = {
  focus_chain: 10,      // same agent + same spirit + 3 meaningful actions in one session
  ship_chain: 15,       // draft -> refine -> publish/complete
  recovery_chain: 20,   // user returns after inactivity and completes a useful action
  circle_chain: 12,     // check-in + task + social contribution same day
  trust_chain: 18,      // user accepts autonomous or high-trust action
} as const;
```

### Anti-spam caps

Needed from day one.

Rules:

- only first `N` trivial messages per session earn `message_sent` bond XP
- repeated no-op terminal calls do not repeatedly award progression
- same event type should have a soft daily diminishing return

Recommended diminishing formula:

```ts
effectiveAmount = baseAmount * (1 / Math.sqrt(repeatCount));
```

Use only for low-value repeatable events, not milestone events.

## Thresholds

### Bond thresholds

Keep current thresholds for PR1:

```ts
[
  { level: 1, xp: 0, title: 'Acquaintance' },
  { level: 2, xp: 100, title: 'Familiar' },
  { level: 3, xp: 300, title: 'Trusted' },
  { level: 4, xp: 600, title: 'Companion' },
  { level: 5, xp: 1000, title: 'Partner' },
  { level: 6, xp: 1500, title: 'Soulmate' },
  { level: 7, xp: 2500, title: 'Legendary' },
  { level: 8, xp: 4000, title: 'Mythic' },
  { level: 9, xp: 6000, title: 'Transcendent' },
  { level: 10, xp: 10000, title: 'Eternal' },
]
```

### Bond unlock map

Recommended unlocks:

- Level 2: personalized greeting pack
- Level 3: memory depth `basic`
- Level 4: aura tier 1
- Level 5: trait reveal and one cosmetic choice
- Level 6: memory depth `contextual`
- Level 7: pet stage upgrade or visual mutation
- Level 8: initiative mode `suggestive`
- Level 9: personalized workflow pack
- Level 10: signature role title + special appearance state

### Mastery thresholds

Recommended:

```ts
[
  { level: 1, xp: 0, title: 'Novice' },
  { level: 2, xp: 75, title: 'Capable' },
  { level: 3, xp: 200, title: 'Skilled' },
  { level: 4, xp: 450, title: 'Expert' },
  { level: 5, xp: 900, title: 'Specialist' },
  { level: 6, xp: 1600, title: 'Elite' },
  { level: 7, xp: 2600, title: 'Master' },
]
```

### Mastery unlock map

- Level 2: spirit-specific suggestion chips
- Level 3: stronger checklist/template pack
- Level 4: second-order spirit branch choice
- Level 5: role certification badge
- Level 6: autonomous ritual proposals
- Level 7: elite workflow pack + room role eligibility

## UI spec

### Surface 1: Agent card progression strip

Where:

- Office
- main Chat header
- agent profile drawer

Must show:

- bond level and title
- bond progress bar
- current spirit
- mastery level in current spirit
- next unlock teaser

Compact layout:

- left: avatar + aura ring
- middle: name, bond title, spirit chip
- right: 2 slim meters for `Bond` and `Mastery`

### Surface 2: Session-end progression summary

Where:

- after meaningful chat or Office work block

Component name:

- `AgentProgressSummaryCard.tsx`

Must show:

- `+User XP`
- `+Bond XP`
- `+Mastery XP`
- combo bonuses triggered
- traits strengthened
- unlock gained
- next milestone distance

Tone:

- celebratory but not childish
- compact enough to appear often

### Surface 3: Evolution reveal modal

Where:

- when crossing a meaningful bond or mastery threshold

Component name:

- `AgentEvolutionReveal.tsx`

Must show:

- agent before/after visual state
- level/title change
- what changed in behavior
- unlocked perk choices if applicable

Recommended sections:

1. `Evolved`
2. `What Changed`
3. `Choose One`

### Surface 4: Progression ledger tab

Where:

- profile or agent details

Component name:

- `ProgressionLedger.tsx`

Must support filters:

- all
- user XP
- bond XP
- mastery XP
- unlocks

This is for power users and balancing visibility.

### Surface 5: Quest and combo chips

Where:

- chat composer footer
- office footer
- daily dashboard

Must show:

- today’s combo opportunities
- current streak
- near-term milestone

Examples:

- `1 action away from Focus Chain`
- `Bond level 5 in 18 XP`
- `Researcher mastery ready to rank up`

## UX behavior

### Event feedback

Use a three-tier feedback hierarchy:

#### Tier 1. Micro feedback

- tiny toast/chip
- no modal
- used for frequent rewards

#### Tier 2. Milestone card

- inline card or stacked banner
- used for combo triggers and notable unlock progress

#### Tier 3. Reveal modal

- blocking or semi-blocking
- used only for bond/mastery level-ups and meaningful unlocks

### Language guidelines

Avoid vague copy:

- not `+5 progress`

Prefer explicit copy:

- `+8 Bond XP`
- `Researcher Mastery +12`
- `Trait strengthened: Skepticism`
- `Unlocked: Aura Tier 1`

### Agent voice integration

When an unlock happens, let the agent comment once.

Examples:

- `I’m starting to anticipate your workflow better.`
- `My Researcher lane sharpened. I’ll challenge weak sources more aggressively.`

Do not overdo this. It should feel special, not noisy.

## Suggested file plan

### Backend / data

- `supabase/migrations/20260404_agent_progression.sql`
- `src/lib/progression.ts`
- `src/lib/mastery.ts`
- `src/lib/progressionCombos.ts`

### UI

- `src/components/progression/AgentProgressStrip.tsx`
- `src/components/progression/AgentProgressSummaryCard.tsx`
- `src/components/progression/AgentEvolutionReveal.tsx`
- `src/components/progression/ProgressionLedger.tsx`
- `src/components/progression/QuestComboChips.tsx`

### Integration points

- `src/lib/agentBonding.ts`
- `src/services/rewardService.ts`
- `src/components/OfficeTerminal.tsx`
- `src/screens/circles/tabs/OfficeTab.tsx`
- `src/screens/circles/tabs/chat/ChatSessionHeader.tsx`
- `src/screens/circles/tabs/chat/ChatStatusBar.tsx`

## PR sequence

### PR1

Goal:

- create the data model and visible progression strip

Scope:

- add `progression_events`
- add `agent_mastery`
- add `agent_evolution_unlocks`
- dual-write new progression events
- create `awardMasteryXP(...)`
- show bond/mastery strip in chat + office

### PR2

Goal:

- make progression feel rewarding

Scope:

- session-end summary card
- combo logic
- milestone card
- first reveal modal

### PR3

Goal:

- add evolution choices

Scope:

- branch unlocks
- memory depth unlocks
- appearance unlocks
- spirit branch promotions

### PR4

Goal:

- expand social progression

Scope:

- circle quests
- shared progression events
- team evolution trophies

## Acceptance criteria

### Data

- new progression events are written for all new bond/mastery actions
- no duplicate unlock rows are created
- mastery progression is per-agent and per-spirit

### UI

- active agent shows bond and mastery progress
- crossing a threshold produces a visible change
- session summaries explain where progression came from

### Product behavior

- trivial spam is not the best way to level
- meaningful use advances agents faster than raw turn count alone
- users can tell the difference between their own level and the agent’s level

## Open implementation decisions

Claude should resolve these explicitly during implementation:

1. whether `agent_mastery` is restricted to one active spirit at a time or supports parallel lanes
2. whether evolution choices are permanent or partially reversible
3. whether `sync_points_to_xp()` should be disabled in PR1 or left in place and marked legacy
4. whether bond/mastery UI belongs in profile drawer only, or directly in the main chat shell too

## Bottom line

Claude should treat this work as a progression unification project, not as a badge tweak.

The first implementation pass should:

- create a canonical event layer
- make agent growth visible
- add mastery as a first-class system
- ensure users feel progression after normal sessions

If those four things land, the app will finally have a believable agent-evolution loop instead of three partially overlapping reward systems.
