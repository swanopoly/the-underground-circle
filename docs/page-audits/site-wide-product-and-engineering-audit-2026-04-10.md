# Site-Wide Product And Engineering Audit

Date: 2026-04-10

## Scope

This audit covers the live app surface as represented by the current codebase, with emphasis on:

- production readiness
- engineering risk
- feature completeness
- information architecture
- implementation sequencing

## Highest-Priority Findings

### 1. The repo is not production-clean at the type-check level

Severity: High

Why it matters:

- The app does not have a clean `npx tsc --noEmit` baseline.
- That means regressions are easier to hide and release confidence is lower than it should be.
- The failures are not isolated to one experimental area. They span app UI, missing packages, model/data typing, and serverless function typing.

Evidence:

- duplicate object key in [`FlatIcon.tsx`](/Users/cswanson/the-underground-circle/src/components/FlatIcon.tsx#L55)
- missing package/type declarations for `expo-camera`, `expo-media-library`, and `tweetnacl`
- React Native Web style/type mismatches in [`LoginScreen.tsx`](/Users/cswanson/the-underground-circle/src/screens/auth/LoginScreen.tsx)
- app-data typing issues in [`officeConfig.ts`](/Users/cswanson/the-underground-circle/src/lib/officeConfig.ts#L899), [`photonProof.ts`](/Users/cswanson/the-underground-circle/src/lib/photonProof.ts), and [`RoomsTab.tsx`](/Users/cswanson/the-underground-circle/src/screens/circles/tabs/RoomsTab.tsx)
- Deno/Supabase function files are being type-checked under the same root TS config in [`tsconfig.json`](/Users/cswanson/the-underground-circle/tsconfig.json)

What needs to change:

- Get the main app to a clean type-check baseline.
- Split app TS config from Supabase function TS config.
- Add missing dependencies or remove dead code paths that require them.

### 2. Several user-facing features are still placeholder or simulated

Severity: High

Why it matters:

- The app presents some capabilities as real product features when they are still partially mocked or not persisted.
- That creates trust erosion fast on a live site.

Evidence:

- stock market data is still mocked in [`marketData.ts`](/Users/cswanson/the-underground-circle/src/lib/marketData.ts#L3) and [`marketData.ts`](/Users/cswanson/the-underground-circle/src/lib/marketData.ts#L46)
- check-in proof validation awards XP but does not persist the validation result in [`CheckInScreen.tsx`](/Users/cswanson/the-underground-circle/src/screens/checkin/CheckInScreen.tsx#L370)

What needs to change:

- Replace simulated finance features with either real data or explicit beta labeling.
- Make proof validation a real persisted workflow with counts, vote history, and UI reflection.

### 3. The codebase is too monolithic in several core product areas

Severity: High

Why it matters:

- Core app surfaces are concentrated in extremely large files, which raises regression risk, slows onboarding, and makes testing/refactoring much harder.
- This is now an architecture problem, not just a style preference.

Evidence:

- [`schoolsData.ts`](/Users/cswanson/the-underground-circle/src/lib/schoolsData.ts) is 6,819 lines
- [`OfficeTab.tsx`](/Users/cswanson/the-underground-circle/src/screens/circles/tabs/OfficeTab.tsx) is 5,826 lines
- [`RoomsTab.tsx`](/Users/cswanson/the-underground-circle/src/screens/circles/tabs/RoomsTab.tsx) is 5,106 lines
- [`ChatTab.tsx`](/Users/cswanson/the-underground-circle/src/screens/circles/tabs/ChatTab.tsx) is 4,910 lines
- [`InteractiveFurniture.tsx`](/Users/cswanson/the-underground-circle/src/screens/circles/tabs/office/InteractiveFurniture.tsx) is 4,385 lines
- [`wikiData.ts`](/Users/cswanson/the-underground-circle/src/lib/wikiData.ts) is 4,292 lines

What needs to change:

- Break screen orchestration from rendering.
- Move giant static datasets into modular content files.
- Create domain-specific hooks/services for Office, Rooms, Chat, Schools, and Wiki.

### 4. Production/runtime boundaries are blurred between app code and backend function code

Severity: High

Why it matters:

- The project currently mixes Expo/React Native app typing with Deno/Supabase function typing in one TS compilation path.
- That makes the tooling noisy and obscures what is actually broken in the app versus the edge functions.

Evidence:

- root TS config in [`tsconfig.json`](/Users/cswanson/the-underground-circle/tsconfig.json) does not separate app and function environments
- full type-check output includes many `Deno` and `https://esm.sh/...` module errors under `supabase/functions/*`

What needs to change:

- Introduce separate TypeScript projects:
  - app/web/mobile
  - Supabase functions
- Add a root task that runs both intentionally instead of one noisy catch-all.

## Medium-Priority Findings

### 5. Authentication and web styling are carrying web-specific type debt

Severity: Medium

Why it matters:

- The login flow is a critical conversion path.
- Current type errors in the login screen suggest web-only styling patterns are bypassing normal RN style safety.

Evidence:

- multiple `outlineStyle: 'none'` and related style typing issues in [`LoginScreen.tsx`](/Users/cswanson/the-underground-circle/src/screens/auth/LoginScreen.tsx)

What needs to change:

- Move web-only style overrides behind typed helpers or `Platform.select`.
- Clean the login screen until it passes strict TS without casts or style-shape drift.

### 6. Content systems are strong conceptually but too coupled to code deployment

Severity: Medium

Why it matters:

- Schools and Wiki are becoming major product surfaces.
- Right now both are hard-coded giant TS files, which makes content updates expensive and increases merge risk.

Evidence:

- [`schoolsData.ts`](/Users/cswanson/the-underground-circle/src/lib/schoolsData.ts)
- [`wikiData.ts`](/Users/cswanson/the-underground-circle/src/lib/wikiData.ts)

What needs to change:

- Split content by track/category into separate files first.
- Then decide whether to keep code-backed content or move to a CMS/database-backed editorial system.

### 7. Existing audit coverage is broad, but implementation follow-through is fragmented

Severity: Medium

Why it matters:

- The repo already has many audit docs, but the app still shows structural issues that those audits likely identified.
- That implies the current bottleneck is execution discipline and prioritization, not idea generation.

Evidence:

- audit inventory in [`docs/page-audits/INDEX.md`](/Users/cswanson/the-underground-circle/docs/page-audits/INDEX.md#L1)

What needs to change:

- Consolidate audit outputs into one execution roadmap with owners, status, and milestones.

## Lower-Priority But Important Findings

### 8. Some integrations read as ambitious breadth before depth

Severity: Medium

Why it matters:

- The app surface spans circles, agents, orgs, schools, wiki, wallets, integrations, and automation.
- That is strategically interesting, but it raises the bar for cohesion. Some surfaces will feel thinner than the flagship flows unless the roadmap narrows around a core loop.

What needs to change:

- Choose the primary product loop explicitly:
  - collaboration/accountability
  - AI work orchestration
  - learning + builder education
- Then subordinate secondary surfaces to that loop.

### 9. Real-data labeling needs to be more explicit

Severity: Medium

Why it matters:

- Users should not need to infer which panels are real, beta, local-only, mocked, or partially wired.

What needs to change:

- Add explicit states:
  - `Live`
  - `Beta`
  - `Connect local agent`
  - `Demo data`
  - `Coming soon`

## What To Fix First

### Phase 1: Stabilize The Foundation

Goal:

- make the repo trustworthy to ship from

Work:

1. Split TS configs for app and Supabase functions.
2. Fix the current app-side type-check failures.
3. Add missing runtime dependencies or remove dead imports.
4. Create `npm` scripts for:
   - `typecheck:app`
   - `typecheck:functions`
   - `typecheck`

Exit criteria:

- app type-check is clean
- function type-check is intentionally scoped
- CI can fail on real regressions instead of environmental noise

### Phase 2: Replace Fake Or Partial Product Behaviors

Goal:

- remove trust-damaging feature gaps

Work:

1. Replace mocked stock data in [`marketData.ts`](/Users/cswanson/the-underground-circle/src/lib/marketData.ts#L46) with a real provider, or visibly downgrade the feature to demo mode.
2. Implement real proof validation persistence for check-ins.
3. Review all “awards XP but does not persist real action” flows and correct them.

Exit criteria:

- no silent demo-data behavior on core dashboards
- no fake write flows presented as complete features

### Phase 3: Refactor The Largest Product Hotspots

Goal:

- reduce regression risk in the most complex surfaces

Work:

1. Break [`OfficeTab.tsx`](/Users/cswanson/the-underground-circle/src/screens/circles/tabs/OfficeTab.tsx) into:
   - dashboard shell
   - toolbar/actions
   - floor orchestration
   - persistence hooks
2. Break [`RoomsTab.tsx`](/Users/cswanson/the-underground-circle/src/screens/circles/tabs/RoomsTab.tsx) into:
   - room list
   - room detail
   - composer
   - persistence/search hooks
3. Break [`ChatTab.tsx`](/Users/cswanson/the-underground-circle/src/screens/circles/tabs/ChatTab.tsx) into:
   - chat shell
   - message feed
   - command/tool panels
   - local-agent bridge pieces
4. Split `schoolsData.ts` and `wikiData.ts` by domain.

Exit criteria:

- no single core app file over ~2,000 lines unless strongly justified
- screen orchestration and content/data concerns are separated

### Phase 4: Clarify The Core Product Loop

Goal:

- make the product feel intentional instead of sprawling

Work:

1. Define the primary homepage / post-login outcome.
2. Decide the ranked product pillars.
3. Re-label secondary surfaces around that hierarchy.
4. Add live/beta/demo/local badges across integrations and panels.

Exit criteria:

- the first-time experience and the daily-return experience are obvious
- users can tell which features are core versus experimental

### Phase 5: Content And Learning System Maturity

Goal:

- turn Schools + Wiki into a maintainable, flagship subsystem

Work:

1. Modularize curriculum and wiki content files.
2. Add editorial metadata:
   - topic
   - difficulty
   - freshness
   - project-based
3. Add saved path/pin/dismiss support for the learning queue.
4. Add track-level analytics and completion funnels.

Exit criteria:

- content can grow without giant merge-heavy files
- learning recommendations are user-shaped, not only system-generated

## Recommended Implementation Order

1. Build hygiene and TS/project separation
2. Placeholder-feature replacement
3. Office/Rooms/Chat decomposition
4. Product hierarchy and status labeling
5. Learning system operationalization

## What To Add

- CI with app/function type-check split
- explicit feature-state badges
- real stock/market data provider or remove the claim
- persisted proof validation
- saved/pinned/dismissed learning queue
- analytics for onboarding, retention, and learning progression

## What To Change

- stop using one root TS config for both Expo and Deno
- stop shipping giant monolithic content and orchestration files
- stop presenting simulated or partially persisted features as complete
- tighten the product around one clearly legible core loop

## What To Leave Alone For Now

- the recent Schools/Wiki learning-path work is directionally right
- the audit system in `docs/page-audits` is useful and should be consolidated, not discarded
- the product breadth is not inherently wrong, but it needs stronger sequencing and labeling

## Product Hierarchy

Confirmed priority order:

1. Collaboration and accountability
2. AI work orchestration
3. Learning and builder education

Implication:

- The center of gravity should be the circle workspace, especially [`CircleDetailScreen.tsx`](/Users/cswanson/the-underground-circle/src/screens/circles/CircleDetailScreen.tsx).
- Schools and Wiki should support the main product loop, not compete with it for homepage or primary navigation attention.

## Execution Roadmap By Screen And Subsystem

### Tier 1: Core Daily-Use Product Surfaces

These screens decide whether the app works as a collaboration/accountability system.

#### 1. Circle Workspace

Primary files:

- [`CircleDetailScreen.tsx`](/Users/cswanson/the-underground-circle/src/screens/circles/CircleDetailScreen.tsx)
- [`OfficeTab.tsx`](/Users/cswanson/the-underground-circle/src/screens/circles/tabs/OfficeTab.tsx)
- [`ChatTab.tsx`](/Users/cswanson/the-underground-circle/src/screens/circles/tabs/ChatTab.tsx)
- [`RoomsTab.tsx`](/Users/cswanson/the-underground-circle/src/screens/circles/tabs/RoomsTab.tsx)
- [`FeedTab.tsx`](/Users/cswanson/the-underground-circle/src/screens/circles/tabs/FeedTab.tsx)
- [`MembersTab.tsx`](/Users/cswanson/the-underground-circle/src/screens/circles/tabs/MembersTab.tsx)
- [`MissionsTab.tsx`](/Users/cswanson/the-underground-circle/src/screens/circles/tabs/MissionsTab.tsx)

Needs:

- make `CircleDetail` the obvious operational home after login
- simplify tab hierarchy so the daily-use tabs are visually prioritized
- reduce overlap between Feed, Missions, Rooms, Chat, and Office
- define the role of each tab in one sentence and enforce it in the UI

Implementation plan:

1. Make the default return path after login always land in the user’s primary circle and its most relevant tab.
2. Rework tab priority into:
   - Office
   - Chat
   - Rooms
   - Feed or Missions
   - Members
   - secondary tabs after that
3. Merge or clarify duplicated execution surfaces:
   - Feed vs Missions
   - Chat vs Rooms discussion usage
4. Extract each flagship tab into:
   - shell
   - data hook
   - focused child panels

Success criteria:

- a user can tell where to go to talk, coordinate, track work, and see activity without guessing
- the daily loop feels centered in the circle workspace, not scattered across product areas

#### 2. Check-In And Accountability

Primary files:

- [`CheckInScreen.tsx`](/Users/cswanson/the-underground-circle/src/screens/checkin/CheckInScreen.tsx)
- related streak/xp flows in check-in and reward systems

Needs:

- proof validation must be real, not cosmetic
- check-in outcomes should visibly feed circle momentum, streaks, and accountability

Implementation plan:

1. Add persisted proof validation storage.
2. Show validation state in UI:
   - pending
   - accepted
   - disputed
3. Tie validated check-ins into member trust and streak surfaces.
4. Surface daily check-in status in the circle workspace header or Office dashboard.

Success criteria:

- check-ins feel like a real social accountability mechanic instead of a side action

#### 3. Circles Entry And Onboarding

Primary files:

- [`CirclesScreen.tsx`](/Users/cswanson/the-underground-circle/src/screens/circles/CirclesScreen.tsx)
- [`CreateCircleScreen.tsx`](/Users/cswanson/the-underground-circle/src/screens/circles/CreateCircleScreen.tsx)
- [`JoinCircleScreen.tsx`](/Users/cswanson/the-underground-circle/src/screens/circles/JoinCircleScreen.tsx)
- [`App.tsx`](/Users/cswanson/the-underground-circle/App.tsx)

Needs:

- faster path from sign-in to active circle workspace
- less friction between “create/join” and “start using the product”

Implementation plan:

1. Treat circles list as a switching surface, not the emotional center of the product.
2. If the user has one clear active circle, route them directly into it by default.
3. Keep the first-run intro short and direct users into Office quickly.
4. Make invite redemption and first-time workspace entry feel like the same flow.

Success criteria:

- the app feels like a workspace first, not a list of containers first

### Tier 2: AI Work Orchestration Layer

These screens matter because they differentiate the product beyond standard accountability apps.

#### 4. Office And Agent Operations

Primary files:

- [`OfficeTab.tsx`](/Users/cswanson/the-underground-circle/src/screens/circles/tabs/OfficeTab.tsx)
- office subcomponents under `src/screens/circles/tabs/office`

Needs:

- Office is strategically important, but it is too large and too mixed right now
- local agent, memory, GitHub, MCP, and floor interactions need clearer product boundaries

Implementation plan:

1. Split Office into:
   - workspace shell
   - floor/canvas management
   - agent operations dashboard
   - integrations dashboard
   - persistence layer
2. Add explicit status labeling per Office subsystem:
   - live
   - beta
   - local-only
   - demo
3. Make the top-level Office dashboard answer:
   - who is active
   - which agents are connected
   - what is running
   - what needs attention

Success criteria:

- Office becomes the command center for orchestration, not a giant mixed feature panel

#### 5. Chat And Rooms

Primary files:

- [`ChatTab.tsx`](/Users/cswanson/the-underground-circle/src/screens/circles/tabs/ChatTab.tsx)
- [`RoomsTab.tsx`](/Users/cswanson/the-underground-circle/src/screens/circles/tabs/RoomsTab.tsx)

Needs:

- Chat should be the fastest path to ask, decide, or invoke work
- Rooms should be the durable project/knowledge context layer
- today those roles are not yet clean enough

Implementation plan:

1. Define:
   - Chat = fast interaction and agent invocation
   - Rooms = persistent project spaces and execution context
2. Pull room/project summaries into Chat when relevant instead of forcing users to switch tabs.
3. Pull active chat tasks or agent runs into Rooms when they become durable work.
4. Refactor both tabs into smaller shells/hooks/components before feature expansion.

Success criteria:

- users understand why both Chat and Rooms exist and when to use each

#### 6. Integrations And Agent Connectivity

Primary files:

- [`IntegrationsScreen.tsx`](/Users/cswanson/the-underground-circle/src/screens/integrations/IntegrationsScreen.tsx)
- Office integration surfaces
- Supabase functions for OAuth and automation

Needs:

- integrations need better environment clarity and lifecycle management
- local agent connection flows should feel trustworthy and explicit

Implementation plan:

1. Add status badges across integrations:
   - connected
   - needs setup
   - local agent required
   - beta
2. Separate cloud integrations from local workstation integrations in the UI.
3. Add setup checklists and success states instead of raw buttons only.

Success criteria:

- users know what is available in-browser versus what depends on their machine

### Tier 3: Learning As A Support System

These surfaces should reinforce adoption and power-user growth after the core loop is solid.

#### 7. Schools And Wiki

Primary files:

- [`SchoolsScreen.tsx`](/Users/cswanson/the-underground-circle/src/screens/schools/SchoolsScreen.tsx)
- [`WikiScreen.tsx`](/Users/cswanson/the-underground-circle/src/screens/wiki/WikiScreen.tsx)
- [`schoolsData.ts`](/Users/cswanson/the-underground-circle/src/lib/schoolsData.ts)
- [`wikiData.ts`](/Users/cswanson/the-underground-circle/src/lib/wikiData.ts)

Needs:

- keep them as enablement and retention surfaces
- avoid letting them feel like the app’s main identity

Implementation plan:

1. Reposition Schools and Wiki as:
   - learn the system
   - level up your workflows
2. Keep integrating them into core tabs:
   - Office tooltips
   - Chat agent education
   - setup guides
3. Modularize the content files before continuing major content expansion.

Success criteria:

- learning supports product mastery instead of pulling focus from execution

## 90-Day Implementation Sequence

### Sprint Block 1: Foundation And Trust

- split TS configs
- clean app type-check
- fix missing dependencies and dead imports
- remove or label mocked/partial features

### Sprint Block 2: Circle Workspace Simplification

- define tab roles
- reorder/trim tab prominence
- route users directly into active circles
- improve check-in visibility and accountability feedback

### Sprint Block 3: Office / Chat / Rooms Refactor

- break monolith files
- clarify orchestration flows
- add status labels and setup states

### Sprint Block 4: Real Collaboration Intelligence

- better member activity summaries
- task and mission clarity
- room summaries and agent execution visibility

### Sprint Block 5: Learning System Operationalization

- modular content architecture
- use Schools/Wiki to support onboarding and power-user mastery
- analytics and personalization for learning surfaces

## Team-Level Workstreams

### Workstream A: Platform And Build Health

- TS config split
- CI
- dependency health
- typed environment boundaries

### Workstream B: Core Workspace UX

- CircleDetail
- Office
- Chat
- Rooms
- Feed or Missions consolidation

### Workstream C: Accountability Mechanics

- check-ins
- streaks
- member activity
- mission completion visibility

### Workstream D: Orchestration And Integrations

- local agent connection UX
- GitHub/MCP/automation surfaces
- explicit feature-state labeling

### Workstream E: Learning Enablement

- Schools
- Wiki
- setup guides
- just-in-time education
