# XP + Agent Evolution Deep Audit

Date: 2026-04-04
Repo: `the-underground-circle`
Scope: current XP gathering, agent progression, evolution opportunities, and ways to make progression more fun

## Executive summary

The app currently has three separate progression systems:

1. `user_xp` for broad account progression
2. `user_points` for rewards/badges, especially Office and agent activity
3. `agent_bonds` for agent-specific relationship growth

That split is the core product problem.

The codebase already contains most of the raw ingredients for agent evolution:

- user XP and achievement events
- user points and badge ladders
- agent bond levels and titles
- soul traits
- agent spirits
- appearance snapshots
- pet/aura/office cosmetics

But those systems are not wired together into one understandable loop. In practice, users gain XP and points, while agents barely evolve in visible, satisfying ways. The result is high activity with weak payoff.

The strongest direction is not to add a fourth ledger. It is to unify progression into one coherent model:

- `User XP` = the player is growing
- `Bond XP` = the relationship with a specific agent is deepening
- `Mastery XP` = the agent is becoming better at a specialty

Agent evolution should not stop at badges or numbers. It should change:

- how the agent looks
- how the agent speaks
- what the agent remembers
- what workflows it can unlock
- what roles it can grow into
- what rituals, quests, or collaborative actions it can initiate

## Current state audit

### 1. User XP exists and is event-driven

Primary implementation:

- `src/lib/gamification.ts`
- `supabase/migrations/20260213_gamification.sql`
- `supabase/migrations/20260310_fix_xp_system.sql`

Current `XP_AMOUNTS` in `src/lib/gamification.ts`:

- `daily_login`: 50
- `check_in`: 150
- `task_complete`: 300
- `circle_join`: 500
- `circle_create`: 1000
- `upvote_received`: 25
- `streak_7day`: 2000
- `streak_30day`: 10000
- `badge_earned`: 5000
- farm/pet/station events also exist

Level formula:

- `level = floor(sqrt(xp / 50)) + 1`
- capped at 100

Titles are level-based and separate from points badges:

- Recruit
- Grinder
- Hustler
- Veteran
- Elite
- OG
- Legend
- Underground Boss
- Underground King

This is a healthy base for player-level progression, but it is mostly user-account oriented, not agent-oriented.

### 2. A separate points economy exists

Primary implementation:

- `src/services/rewardService.ts`
- `src/lib/badges.ts`
- `supabase/migrations/20260226_rewards.sql`
- `supabase/migrations/20260227_atomic_xp.sql`

This system tracks:

- `user_points`
- `points_transactions`
- `user_badges`

It is also the system most directly tied to agent activity.

Important detail: Office and agent turns award `points`, not `bond_xp`.

Examples:

- `awardAgentTurnPoints(...)`
- `useAgentPointsTracker(...)`
- `useAllAgentPointsTracker(...)`
- `src/components/OfficeTerminal.tsx`
- `src/screens/circles/tabs/OfficeTab.tsx`

This means the app currently treats agent usage as a source of player rewards, not as a source of agent growth.

### 3. There is already an agent progression system

Primary implementation:

- `src/lib/agentBonding.ts`

This is the most important underused system in the repo.

Current bond thresholds:

- Level 1: Acquaintance
- Level 2: Familiar
- Level 3: Trusted
- Level 4: Companion
- Level 5: Partner
- Level 6: Soulmate
- Level 7: Legendary
- Level 8: Mythic
- Level 9: Transcendent
- Level 10: Eternal

Current bond XP actions:

- `message_sent`
- `task_completed`
- `session_started`
- `customization_saved`
- `name_given`
- `soul_trait_learned`
- `daily_interaction`
- `long_session`
- `milestone_reached`

The same file already supports:

- soul traits
- favorite topics
- communication style
- strengths
- bound provider/model
- primary-agent designation
- appearance snapshot

This is exactly the layer that should power agent evolution. Right now it is structurally present but product-light.

### 4. Agent specialization already exists in another lane

Primary implementation:

- `src/lib/agentSpirits.ts`
- `src/lib/agentMessaging.ts`
- `src/lib/officeConfig.ts`

The app already has:

- explicit agent spirit archetypes
- prompt/personality specialization
- office pet stages
- agent visual customization
- appearance snapshots

This means the app does not need to invent “evolution” from scratch. It needs to connect progression to these existing systems.

## Where XP is gathered today

### User XP gathering

Confirmed award sites:

- `src/screens/checkin/CheckInScreen.tsx`
  - check-in submission
  - streak bonus
  - upvote received
  - proof validation
- `src/hooks/useKanbanData.ts`
  - task completion
- `src/screens/circles/CreateCircleScreen.tsx`
  - circle creation
- `src/screens/circles/JoinCircleScreen.tsx`
  - circle join
- `src/screens/wallet/ConnectWalletScreen.tsx`
  - wallet connect
- `src/lib/photonProof.ts`
  - proof validation and streak milestones
- `src/screens/circles/tabs/ChatTab.tsx`
  - legacy quick actions

### User points gathering

Confirmed award sites:

- `src/services/rewardService.ts`
  - agent turn and aggregate activity scoring
- `src/components/OfficeTerminal.tsx`
  - terminal command usage
- `src/screens/circles/tabs/OfficeTab.tsx`
  - all-agent tracker

### Agent bond gathering

Agent bond XP exists in `src/lib/agentBonding.ts`, but there is much less evidence of it driving the main visible loops compared with points.

That imbalance is why “agent evolution” feels underdeveloped even though the app technically supports it.

## Primary findings

### Finding 1. Progression is fragmented across three ledgers

Severity: high

The app currently has:

- `xp_events` for user XP
- `points_transactions` for user points
- `agent_bonds` for agent relationship XP

These are conceptually adjacent but behaviorally disconnected. A user can spend hours with an agent and see points go up while the agent itself barely appears to evolve. The product is rewarding usage without clearly rewarding relationship or specialization growth.

Impact:

- users cannot easily understand what they are progressing
- the agent feels less alive than the data model suggests
- design energy gets split across separate reward surfaces
- future balancing becomes difficult because three economies compete

### Finding 2. “Agent XP” is mostly user reward, not agent growth

Severity: high

`src/services/rewardService.ts` and `src/lib/badges.ts` award the user points based on agent turns and model choice. That is useful for retention, but it is not agent evolution.

A user will reasonably assume:

- more work with an agent should make that agent evolve

Current behavior is closer to:

- more work with an agent increases the owner’s score

That is a mismatch between fantasy and implementation.

### Finding 3. The points and XP systems are partially collapsed together in the database

Severity: high

`supabase/migrations/20260310_fix_xp_system.sql` recreates `sync_points_to_xp()` so `user_points.lifetime_points` syncs into `user_xp.total_xp`.

That may be convenient for denormalization, but product-wise it muddies the meaning of both systems:

- Are points prestige currency?
- Is XP the same thing?
- Is Office usage supposed to define account level?
- Is agent work supposed to outweigh human social/community actions?

This is survivable technically but confusing strategically.

### Finding 4. The strongest evolution infrastructure is underused

Severity: high

`src/lib/agentBonding.ts` already contains the best evolution substrate in the codebase:

- bond levels
- soul traits
- strengths
- favorite topics
- appearance snapshots
- primary-agent logic

That should be a headline system. Right now it behaves more like side infrastructure.

### Finding 5. Current reward tuning favors volume and model choice over meaningful outcomes

Severity: medium-high

In `src/lib/badges.ts`, `getPointsForModel(model)` awards more points to certain models. In `src/services/rewardService.ts`, agent turns are rewarded in batches. In `src/components/OfficeTerminal.tsx`, terminal commands also award points.

This creates several biases:

- model selection can be more lucrative than meaningful task success
- repeated low-value activity can outscore meaningful work
- quantity of turns can dominate quality of outcomes

That is not fatal for an internal prototype, but it is weak game design for a broader product.

### Finding 6. Current achievements are mostly accounting milestones

Severity: medium

The achievement system in `src/lib/gamification.ts` and `supabase/migrations/20260213_gamification.sql` mostly checks:

- counts
- streaks
- upvotes
- circles joined
- tasks completed
- wallet connected

These are valid, but they are shallow. They measure accumulation more than transformation.

What is missing:

- mastery achievements
- collaboration achievements
- recovery/comeback achievements
- creativity achievements
- agent-specific evolution milestones
- choice-driven branching milestones

### Finding 7. Evolution lacks visible ceremonies

Severity: medium

Even good progression systems feel flat if users do not feel the moment of change.

There is currently little evidence of:

- evolution reveal moments
- before/after visuals
- unlock cards
- trait emergence screens
- session-end progression summaries
- anticipation meters

Without those, progression remains abstract.

### Finding 8. Agent identity growth is not clearly tied to memory growth

Severity: medium

The app already has bond traits and spirits, but evolution should also change what the agent can carry forward.

External agent research consistently points toward memory, reflection, and planning as core ingredients for long-horizon behavior. Right now the local codebase has early trait systems, but not a clear player-facing notion that:

- this agent remembers me better now
- this agent can infer stronger preferences now
- this agent unlocked a new role or planning depth because of growth

### Finding 9. XP is generous, but not always playful

Severity: medium

The code explicitly says XP should flow constantly. That is fine. The problem is that generous XP alone does not create delight.

Fun progression usually needs:

- visible progress
- meaningful choice
- social comparison or collaboration
- surprise
- transformation
- anticipation

The current system has visible numbers, but less of the other ingredients.

## Research synthesis

### Self-Determination Theory: fun progression supports autonomy, competence, and relatedness

Useful sources:

- Self-Determination Theory, intrinsic motivation page:
  - https://selfdeterminationtheory.org/topics/application-intrinsic-motivation/
- Player Experience of Need Satisfaction:
  - https://selfdeterminationtheory.org/player-experience-of-needs-satisfaction-pens/
- Basic psychological need satisfaction:
  - https://selfdeterminationtheory.org/basic-psychological-need-satisfaction-and-frustration-scale/

Why it matters here:

- `Autonomy`: users need real choice in how they grow an agent
- `Competence`: users need proof they are getting better and shaping better agents
- `Relatedness`: users need a felt bond with the agent and with the circle

This is directly relevant because the app is not only a utility product. It is trying to create attachment, momentum, and identity.

### Gamification research: achievement and social layers matter more than raw points

Useful source:

- Xi & Hamari, 2019:
  - https://doi.org/10.1016/j.ijinfomgt.2018.12.002
  - https://www.sciencedirect.com/science/article/pii/S0268401218307436

The relevant takeaway is not “points work.” The stronger takeaway is that achievement and social gamification predict satisfaction of autonomy, competence, and relatedness better than a thin reward wrapper.

Implication for this app:

- XP should not just reward activity
- XP should reinforce social identity and felt progression
- agent evolution should be relational and visible, not just numerical

### Language-agent research: evolution should change memory and planning, not just cosmetics

Useful sources:

- CoALA:
  - https://huggingface.co/papers/2309.02427
  - https://collaborate.princeton.edu/en/publications/cognitive-architectures-for-language-agents/
- Generative Agents:
  - https://huggingface.co/papers/2304.03442

Relevant design takeaway:

- stronger agents emerge from better memory, reflection, planning, and action organization

Implication for this app:

- evolved agents should not only get new skins
- evolved agents should gain better recall, stronger specialties, richer rituals, and more coherent long-horizon behavior

## Recommended target model

### Keep three progression layers, but make them explicit and non-competing

Do not hide the three layers. Name them clearly.

#### 1. User XP

Purpose:

- tracks the human player’s growth in the Underground ecosystem

Should reward:

- check-ins
- task completion
- consistency
- circle participation
- contribution quality

Should unlock:

- profile titles
- account-level perks
- seasonal ladders
- social prestige

#### 2. Bond XP

Purpose:

- tracks the relationship depth between a user and a specific agent

Should reward:

- repeated interaction
- sustained sessions
- naming/customizing the agent
- trusting the agent with bigger work
- feedback loops
- shared rituals

Should unlock:

- new dialogue tone
- memory depth
- relationship scenes
- pet/aura growth
- appearance changes
- “knows me better now” moments

#### 3. Mastery XP

Purpose:

- tracks what the agent is becoming good at

Should reward:

- successful outcomes in a specialty
- repeated use in a role
- positive user ratings
- clean completion streaks
- challenge completion

Should unlock:

- spirit evolution
- new tools/workflows
- role certifications
- deeper prompts and planning modes
- artifact templates
- specialized room powers

## How agents should evolve after enough XP

### Evolution should happen in stages

Recommended agent evolution stack:

1. Bond stage
2. Form stage
3. Spirit stage
4. Mastery stage
5. Circle role stage

### 1. Bond stage

Use the existing `agent_bonds` system as the backbone.

Suggested visible outcomes by bond level:

- Level 1-2: learns your name, default tone softens
- Level 3-4: starts recalling recurring goals/topics
- Level 5-6: unlocks personalized rituals and “I know how you work” summaries
- Level 7-8: gains exclusive voice/style variants and stronger initiative
- Level 9-10: becomes a signature companion with persistent identity moments

### 2. Form stage

Tie bond progression to visible appearance growth.

The repo already has:

- `appearanceSnapshot`
- office pet concepts
- `petStage`
- aura/customization surfaces

Use those to create visible transformations:

- new aura bands
- office desk upgrades
- pet morphs
- companion accessories
- animated entrance/emote changes

The user should be able to say, “this agent looks more evolved now.”

### 3. Spirit stage

Tie growth to specialization branches rather than flat leveling.

The repo already has `agentSpirits.ts`. Use it as a specialization tree.

Example:

- a general helper evolves into `coach`, `strategist`, `writer`, `researcher`, `designer`, `pm`, `mentor`, `security`, or `trader`

Then allow second-order evolution:

- `coach` -> `performance coach` or `life systems coach`
- `researcher` -> `market researcher` or `deep research analyst`
- `writer` -> `brand writer` or `storyteller`

That creates autonomy, identity, and replayability.

### 4. Mastery stage

Once an agent specializes, it should gain mastery perks based on successful work.

Examples:

- stronger checklists
- richer memory summaries
- better reusable templates
- task starter packs
- deeper prompt scaffolds
- room automations
- suggested next actions

This is where evolution becomes behaviorally meaningful.

### 5. Circle role stage

At high trust and mastery, agents should become community actors, not just private helpers.

Examples:

- kickoff host
- digest curator
- check-in coach
- project planner
- celebration announcer
- accountability enforcer

This makes agent evolution social, which increases retention.

## How to make gaining XP more fun

### 1. Add short-cycle feedback

Every rewarding action should produce a compact, attractive progression response:

- XP toast
- bond spark
- mastery pip
- streak glow
- “trait strengthened” chip

Avoid giant modal spam. Favor small, immediate feedback with occasional larger ceremonies.

### 2. Add session-end progression summaries

After a meaningful chat or Office session, show:

- user XP earned
- bond XP earned
- mastery XP earned
- traits strengthened
- unlock progress
- streak changes

This turns invisible accumulation into a satisfying recap.

### 3. Add combo logic

Reward chains are more fun than isolated events.

Examples:

- check-in + task complete same day
- long agent session + action taken
- 3-day focused streak in the same spirit lane
- “publish after draft” combo
- “research -> summarize -> decide” combo

This makes users feel like they are on runs, not just collecting scraps.

### 4. Add evolution ceremonies at milestone thresholds

At important bond or mastery thresholds:

- dim the background
- animate the aura/pet/agent card
- reveal a new title or trait
- show what changed
- let the user pick 1 of 2 evolution perks

Choice matters. Choice makes growth feel owned.

### 5. Add branching evolution

Purely linear growth gets boring.

Let users choose among branches:

- more playful vs more disciplined
- more creative vs more analytical
- more proactive vs more careful
- more social vs more private

These choices should adjust prompts, UI labels, rituals, and unlocks.

### 6. Add social and circle-level progression

The app is not a single-player toy. Use that.

Examples:

- circle quests
- collaborative rituals
- shared streak bonuses
- “your circle pushed 5 agents to level-up this week”
- role-based agent trophies for the room

This is important because the app’s strongest moat is social AI, not solo leveling alone.

### 7. Add surprise rewards, but keep them explainable

Fun improves when not every reward is perfectly predictable.

Examples:

- rare memory crystal drop after a great long session
- cosmetic mutation chance at milestone evolution
- “trait breakthrough” event after repeated themed use
- mood-based seasonal effects

Do not make rewards feel random and unfair. Use surprise bonuses, not opaque punishment.

### 8. Reward outcomes, not just activity

Add higher-value XP for meaningful completion states:

- task actually shipped
- circle goal moved forward
- check-in streak recovered after slump
- user confirmed agent output was useful
- workflow completed end-to-end

This reduces spammy optimization and improves the feeling of earned progress.

### 9. Make the agent react to its own growth

The most fun version of progression is when the evolved character knows it evolved.

Examples:

- “I’m starting to understand how you structure your mornings.”
- “You trust me with planning now. I’ll carry more of the structure.”
- “My researcher spirit has sharpened. I’ll challenge weak claims more aggressively.”

Those moments make evolution feel alive.

## Proposed product architecture

### New canonical progression event model

Recommended new table:

- `progression_events`

Suggested columns:

- `id`
- `user_id`
- `circle_id`
- `agent_id`
- `session_id`
- `event_family` (`user_xp`, `bond_xp`, `mastery_xp`, `cosmetic_unlock`, `quest_progress`)
- `event_type`
- `amount`
- `quality_score`
- `metadata`
- `created_at`

This does not have to replace existing ledgers on day one. It should become the canonical analytics and balancing layer.

### New agent mastery table

Recommended:

- `agent_mastery`

Suggested columns:

- `id`
- `user_id`
- `circle_id`
- `agent_id`
- `spirit_id`
- `mastery_xp`
- `mastery_level`
- `success_count`
- `quality_rating_avg`
- `last_promoted_at`
- `unlocked_nodes`

### New evolution unlock table

Recommended:

- `agent_evolution_unlocks`

Suggested columns:

- `id`
- `agent_id`
- `unlock_type`
- `unlock_key`
- `source`
- `granted_at`

Examples:

- aura
- pet_form
- voice_style
- memory_depth
- initiative_mode
- workflow_pack
- spirit_branch

## Balancing recommendations

### Keep generous baseline XP

The repo’s instinct to make XP flow is directionally correct. Dead progression is worse than generous progression.

But rebalance around:

- meaning
- diversity
- streak preservation
- outcome quality
- social contribution

### Suggested weighting model

Reward types should roughly follow this order:

1. meaningful outcomes
2. sustained consistency
3. collaborative/social contribution
4. exploratory play
5. raw activity

Raw activity should still count, but it should be the weakest source once the system matures.

### Stop over-rewarding model selection

Rewarding certain models with more points can remain as a premium flavor layer, but it should not be a central driver of growth. Otherwise the economy starts to feel like “pick the lucrative backend” instead of “grow your agent.”

## Recommended rollout

### Phase 1. Audit-safe cleanup

- stop describing user points as agent XP
- add clearer labels in UI and docs
- add a progression glossary
- add event analytics to compare XP vs points vs bond activity

### Phase 2. Surface bond progression

- show bond level everywhere an agent is prominent
- show next unlock progress
- trigger visible micro-feedback on bond gains
- add milestone ceremonies

### Phase 3. Add mastery progression

- create per-agent specialty XP
- tie it to spirits
- unlock practical behavior upgrades

### Phase 4. Add evolution choices

- branch perks
- cosmetic changes
- role unlocks
- stronger memory/initiative behavior

### Phase 5. Add social progression loops

- circle quests
- shared unlocks
- team evolution events
- room trophies and displays

## Claude-ready recommendations

If this is handed to Claude for implementation planning, the next concrete output should be:

1. a schema dossier for `progression_events`, `agent_mastery`, and `agent_evolution_unlocks`
2. an integration plan showing how existing `awardXP`, `awardPoints`, and `awardBondXP` map into the new model
3. a UI spec for:
   - session-end progression summary
   - agent evolution card
   - bond/mastery meters
   - unlock reveal modal
4. a balancing sheet with:
   - base rewards
   - combo bonuses
   - milestone thresholds
   - anti-spam caps

## Bottom line

The app does not have an “XP idea” problem. It has a cohesion problem.

The current codebase already contains:

- a user progression system
- a points and badge economy
- a relationship-based agent progression system
- a specialization system
- cosmetic evolution hooks

That is enough to build a strong agent-evolution loop.

The winning direction is:

- unify the meaning of progression
- make agent growth visible
- tie evolution to memory, identity, and specialization
- reward outcomes and relationships, not only raw activity
- make milestone moments feel ceremonial, social, and alive

If this is done well, XP stops being a background number and becomes one of the product’s strongest emotional systems.
