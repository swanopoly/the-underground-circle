# Library Adoption Research And Implementation Plan

Date: 2026-04-07

## Goal

Evaluate the requested libraries against the current Underground Circle stack, identify the best-fit surfaces in the app, and give Claude Code a concrete, low-risk adoption plan with at least one real feature from each library.

## Current repo constraints that matter

- The project is an Expo 54 + React Native 0.81 + React 19 app with `react-native-web`, not a standard Next.js or React DOM app.
- Several of the requested libraries are web-first React DOM libraries. They should be treated as `Platform.OS === 'web'` features unless proven otherwise.
- The repo does not currently use Material UI, `shadcn/ui`, or Tailwind as a first-class app-wide foundation.
- Because of that, the correct adoption pattern is selective and surface-specific, not a full design-system rewrite.

## Surfaces reviewed in this repo

- [src/screens/auth/LoginScreen.tsx](/Users/cswanson/the-underground-circle/src/screens/auth/LoginScreen.tsx)
- [src/screens/circles/CirclesScreen.tsx](/Users/cswanson/the-underground-circle/src/screens/circles/CirclesScreen.tsx)
- [src/screens/circles/CircleDetailScreen.tsx](/Users/cswanson/the-underground-circle/src/screens/circles/CircleDetailScreen.tsx)
- [src/screens/circles/tabs/chat/ChatTabShell.tsx](/Users/cswanson/the-underground-circle/src/screens/circles/tabs/chat/ChatTabShell.tsx)
- [src/screens/circles/tabs/RoomsTab.tsx](/Users/cswanson/the-underground-circle/src/screens/circles/tabs/RoomsTab.tsx)
- [src/screens/circles/tabs/FeedTab.tsx](/Users/cswanson/the-underground-circle/src/screens/circles/tabs/FeedTab.tsx)
- [src/screens/circles/tabs/OfficeTab.tsx](/Users/cswanson/the-underground-circle/src/screens/circles/tabs/OfficeTab.tsx)
- [src/screens/profile/ProfileScreen.tsx](/Users/cswanson/the-underground-circle/src/screens/profile/ProfileScreen.tsx)
- [src/screens/wallet/WalletDashboard.tsx](/Users/cswanson/the-underground-circle/src/screens/wallet/WalletDashboard.tsx)
- [src/components/OfficeAnalyticsPanel.tsx](/Users/cswanson/the-underground-circle/src/components/OfficeAnalyticsPanel.tsx)
- [src/components/FarmHealthDashboard.tsx](/Users/cswanson/the-underground-circle/src/components/FarmHealthDashboard.tsx)
- [src/components/LLMBenchmarkPanel.tsx](/Users/cswanson/the-underground-circle/src/components/LLMBenchmarkPanel.tsx)
- [src/components/ModelLabPanel.tsx](/Users/cswanson/the-underground-circle/src/components/ModelLabPanel.tsx)
- [src/components/TrainingDashboard.tsx](/Users/cswanson/the-underground-circle/src/components/TrainingDashboard.tsx)

## Executive recommendation

Do not spread all eight libraries across the whole app.

Use them as specialized upgrades:

- visual-motion libraries on hero and shell surfaces
- data and tree libraries on power-user workspace surfaces
- builder/editor libraries on content surfaces
- command palette on app-wide navigation and actions
- payment UI only where the product truly needs payment collection

The clean rollout is:

1. `kbar` for global command/navigation.
2. `react-complex-tree` for Rooms files and repo trees.
3. `MUI X Data Grid` for web-only operational tables.
4. one visual-effects pass using Aceternity-style effects and React Bits on login/chat/rooms.
5. `Puck` for a visual Circle page builder.
6. `react-insta-stories` for ephemeral updates in Feed.
7. `react-credit-cards` only when a real billing or funding flow is in place.

## Library-by-library findings

### 1. Acuity UI Effects

Research finding:

- I could not verify a canonical upstream package or official docs for a library named `Acuity UI Effects`.
- The feature list you gave, including lamp effects, glare cards, and interactive text, strongly matches the Aceternity UI ecosystem and its ports.
- Official Aceternity source: https://ui.aceternity.com/

Practical interpretation:

- Treat this request as adopting Aceternity-style visual effects, not hard-coding to an unverified package name.
- These effects are best used as design patterns or copied web-only components, not as a global dependency strategy.

Best implementation points in this repo:

- [src/screens/auth/LoginScreen.tsx](/Users/cswanson/the-underground-circle/src/screens/auth/LoginScreen.tsx)
- [src/screens/circles/CirclesScreen.tsx](/Users/cswanson/the-underground-circle/src/screens/circles/CirclesScreen.tsx)
- [src/screens/circles/tabs/chat/ChatTabShell.tsx](/Users/cswanson/the-underground-circle/src/screens/circles/tabs/chat/ChatTabShell.tsx)
- [src/screens/circles/tabs/RoomsTab.tsx](/Users/cswanson/the-underground-circle/src/screens/circles/tabs/RoomsTab.tsx)

Feature to add:

- Add a web-only neon-green lamp hero + glare room cards to the login and circle landing surfaces.
- Add animated reveal text in the chat empty state using the existing neon login green.

What Claude should build:

- `src/components/web-effects/LampHero.web.tsx`
- `src/components/web-effects/GlareCard.web.tsx`
- `src/components/web-effects/TextReveal.web.tsx`
- wire them only when `Platform.OS === 'web'`

Why this is a fit:

- The app already wants a bold, inviting visual identity.
- These effects suit marketing, onboarding, and empty states far better than task-heavy or admin-heavy screens.

What not to do:

- Do not inject these effects into dense task, table, editor, or inspector views.
- Do not make Rooms harder to scan by putting glare and moving gradients behind core work surfaces.

### 2. React Bits

Official source:

- https://pro.reactbits.dev/docs/installation

Important constraint:

- React Bits assumes a `shadcn/ui` style setup and explicitly lists `shadcn/ui` initialization as a prerequisite.
- The repo does not currently use `shadcn/ui` as a foundation.

Practical interpretation:

- Do not attempt a full React Bits migration.
- Use it as inspiration or selectively adopt CSS-compatible pieces in isolated web surfaces.

Best implementation points:

- [src/screens/circles/tabs/chat/ChatTabShell.tsx](/Users/cswanson/the-underground-circle/src/screens/circles/tabs/chat/ChatTabShell.tsx)
- [src/screens/circles/tabs/FeedTab.tsx](/Users/cswanson/the-underground-circle/src/screens/circles/tabs/FeedTab.tsx)
- [src/screens/circles/tabs/RoomsTab.tsx](/Users/cswanson/the-underground-circle/src/screens/circles/tabs/RoomsTab.tsx)

Feature to add:

- Add springy, rounded, animated shell primitives for chat and room overview cards.
- Add a modern staggered entrance for starter prompts, room cards, and feed summary modules.

What Claude should build:

- A local `motion-primitives` layer instead of a direct design-system dependency:
- `src/components/motion/FadeSlideIn.tsx`
- `src/components/motion/BubblePressable.tsx`
- `src/components/motion/StaggerGroup.tsx`
- `src/components/motion/HoverLift.web.tsx`

Why this is a fit:

- The app needs more modern motion and softer affordances.
- Recreating the useful patterns locally is safer than forcing `shadcn` assumptions into a React Native Web app.

What not to do:

- Do not introduce a second parallel component system.
- Do not depend on React Bits blocks that assume DOM-only structure and Tailwind-heavy styling unless they are isolated in `.web.tsx` files.

### 3. MUI X Data Grid

Official source:

- https://mui.com/x/react-data-grid/

Key capabilities from official docs:

- robust rows/columns presentation
- sorting, filtering, pagination, selection, virtualization
- tree data and grouping in paid tiers

Best implementation points:

- [src/components/OfficeAnalyticsPanel.tsx](/Users/cswanson/the-underground-circle/src/components/OfficeAnalyticsPanel.tsx)
- [src/components/LLMBenchmarkPanel.tsx](/Users/cswanson/the-underground-circle/src/components/LLMBenchmarkPanel.tsx)
- [src/components/ModelLabPanel.tsx](/Users/cswanson/the-underground-circle/src/components/ModelLabPanel.tsx)
- [src/components/TrainingDashboard.tsx](/Users/cswanson/the-underground-circle/src/components/TrainingDashboard.tsx)
- [src/screens/circles/tabs/FeedTab.tsx](/Users/cswanson/the-underground-circle/src/screens/circles/tabs/FeedTab.tsx)
- [src/screens/circles/tabs/RoomsTab.tsx](/Users/cswanson/the-underground-circle/src/screens/circles/tabs/RoomsTab.tsx)

Best feature to add:

- Replace ad hoc admin tables with a web-only operational grid for task runs, agent activity, service health, and room usage.

High-confidence PR1 candidate:

- Add a `Task Runs Grid` to Feed or Office analytics for web users only.

What Claude should build:

- `src/components/grids/TaskRunsGrid.web.tsx`
- `src/components/grids/AgentActivityGrid.web.tsx`
- `src/components/grids/RoomServicesGrid.web.tsx`
- a small adapter layer that maps current Supabase rows into grid columns

Why this is a fit:

- This app has several power-user operational dashboards already.
- Data Grid is strongest where density, sortability, filtering, and selection matter.

What not to do:

- Do not try to use MUI X across native mobile surfaces.
- Do not mix MUI component theming into the existing app shell everywhere. Use it as an embedded power-user island on web.

### 4. react-complex-tree

Official sources:

- https://github.com/lukasbach/react-complex-tree
- official docs linked from README: https://rct.lukasbach.com

Key capabilities from upstream:

- accessible tree semantics
- multi-select
- drag and drop
- keyboard support
- unopinionated rendering

Best implementation point:

- [src/screens/circles/tabs/RoomsTab.tsx](/Users/cswanson/the-underground-circle/src/screens/circles/tabs/RoomsTab.tsx)

Secondary implementation point:

- GitHub repo tree browsing inside Rooms when a repo is connected

Feature to add:

- Replace the hand-rolled room file tree with an accessible real tree that supports rename, drag-drop, folder moves, and keyboard navigation on web.

What Claude should build:

- `src/components/rooms/RoomFileTree.web.tsx`
- `src/components/rooms/GitHubRepoTree.web.tsx`
- `src/lib/roomTreeAdapter.ts`

Why this is a fit:

- Rooms is the clearest tree-shaped domain in the product.
- The current room surface is overloaded and would benefit from a stronger file-navigation primitive.

What not to do:

- Do not wire destructive drag-drop moves without confirmation and patch preview.
- Do not force the library onto mobile if mobile Rooms does not yet support advanced file management ergonomically.

### 5. Puck

Official source:

- https://puckeditor.com/docs

Key capabilities from official docs:

- modular open-source visual editor for React
- custom drag-and-drop experiences using your own React components
- data ownership and no vendor lock-in
- dynamic props, dynamic fields, external data sources, permissions API

Best implementation points:

- public Circle landing pages
- profile pages
- room overview pages and wikis
- campaign / announcement pages for Feed

Feature to add:

- Add a visual `Circle Page Builder` so admins can assemble public or internal pages from existing product components.

Best first surface:

- Circle profile / landing page editor

What Claude should build:

- `src/screens/circles/CirclePageBuilderScreen.web.tsx`
- `src/components/puck/puckConfig.tsx`
- `src/components/puck/blocks/HeroBlock.tsx`
- `src/components/puck/blocks/StoryRailBlock.tsx`
- `src/components/puck/blocks/AgentCardGridBlock.tsx`
- `src/components/puck/blocks/FeedHighlightBlock.tsx`

Why this is a fit:

- The app has rich social/workspace content but limited no-code composition.
- Puck fits content assembly better than task execution or dense admin tooling.

What not to do:

- Do not use Puck to build every screen in the app.
- Keep it scoped to editorial, profile, landing, and presentation surfaces.

### 6. react-insta-stories

Official source:

- https://github.com/mohitk05/react-insta-stories

Key capabilities from upstream:

- Instagram-style stories
- tap next/previous
- pause/hold interactions
- configurable duration

Best implementation points:

- [src/screens/circles/tabs/FeedTab.tsx](/Users/cswanson/the-underground-circle/src/screens/circles/tabs/FeedTab.tsx)
- [src/screens/profile/ProfileScreen.tsx](/Users/cswanson/the-underground-circle/src/screens/profile/ProfileScreen.tsx)
- optional room update recaps in [src/screens/circles/tabs/RoomsTab.tsx](/Users/cswanson/the-underground-circle/src/screens/circles/tabs/RoomsTab.tsx)

Feature to add:

- Add `Circle Stories` to Feed for daily check-ins, agent wins, room updates, launches, and milestone moments.

What Claude should build:

- `src/components/stories/CircleStoriesRail.web.tsx`
- `src/components/stories/storyMappers.ts`
- `src/components/stories/StoryComposerPrompt.tsx`

Why this is a fit:

- The app already has social, progress, and agent activity data.
- Stories are a better fit for short-lived highlights than long dashboards.

What not to do:

- Do not let stories become the primary navigation paradigm.
- Keep them additive and lightweight.

### 7. kbar

Official source:

- https://github.com/timc1/kbar

Key capabilities from upstream:

- fast command palette
- provider-based integration
- extensible action system

Best implementation points:

- app-wide, anchored around [src/screens/circles/CircleDetailScreen.tsx](/Users/cswanson/the-underground-circle/src/screens/circles/CircleDetailScreen.tsx)
- especially useful in chat, rooms, feed, and office

Feature to add:

- Add a global command palette for navigation and high-value actions.

Minimum command set:

- open chat
- open rooms
- open feed
- open office
- create room
- create task
- start chat session
- open current room files
- switch model
- jump to wallet
- open profile

What Claude should build:

- `src/components/command/KBarProvider.web.tsx`
- `src/components/command/commandRegistry.ts`
- `src/components/command/useCircleCommands.ts`
- `src/components/command/CommandPaletteEntry.tsx`

Why this is a fit:

- The app already has too many surfaces.
- A command palette reduces navigation friction immediately and complements the agent-chat direction.

What not to do:

- Do not overload it with every obscure action on day one.
- Start with navigation and 10-20 high-value commands.

### 8. react-credit-cards

Official source:

- https://github.com/amarofashion/react-credit-cards

Important constraint:

- This is a web-style payment form component, not a broad wallet or crypto UX framework.

Best implementation points:

- [src/screens/wallet/WalletDashboard.tsx](/Users/cswanson/the-underground-circle/src/screens/wallet/WalletDashboard.tsx) only if the wallet expands into card-based checkout or subscription purchase
- org billing surfaces if they become first-class

Feature to add:

- Add a hosted billing / upgrade modal for card entry when users buy premium features, agent credits, or workspace upgrades.

What Claude should build:

- `src/components/billing/CardCheckoutForm.web.tsx`
- `src/components/billing/BillingUpgradeModal.tsx`
- optional integration entrypoint from billing or wallet screens

Why this is a fit:

- The current app already has a wallet/dashboard direction.
- If subscriptions, credits, or team billing are added, a polished card form is useful.

What not to do:

- Do not force card UI into crypto transfer flows.
- Do not add this library before there is a real billing backend or hosted payment flow.

## Best feature set from each library

If the requirement is at least one concrete feature per library, the strongest set is:

- Aceternity-style effects: neon lamp hero + glare cards on login/circle discovery
- React Bits-inspired motion: staggered bubble cards and animated prompt chips in Chat and Rooms
- MUI X Data Grid: Feed or Office task-runs grid on web
- react-complex-tree: real room file tree with keyboard navigation and drag-drop
- Puck: visual Circle page builder
- react-insta-stories: Circle Stories rail in Feed
- kbar: global command palette
- react-credit-cards: billing upgrade modal with polished card entry

## Recommended implementation order

### Phase 1: immediate wins

- `kbar`
- `react-complex-tree`
- one Aceternity-style hero/cards pass
- one React Bits-inspired motion pass

Reason:

- best UX payoff
- lowest product ambiguity
- limited schema impact

### Phase 2: operational power surfaces

- `MUI X Data Grid`
- `react-insta-stories`

Reason:

- these deepen existing Feed/Office value without changing app architecture

### Phase 3: platform expansion

- `Puck`
- `react-credit-cards`

Reason:

- both imply new product capability, not just UI polish

## Platform strategy

### Web-only by default

These should be `.web.tsx` first unless a native path is explicitly validated:

- MUI X Data Grid
- react-complex-tree
- kbar
- react-insta-stories
- react-credit-cards
- most Aceternity-style effects

### Cross-platform wrappers

For each web-only tool, Claude should create:

- a shared wrapper component
- a web implementation
- a simple native fallback

Example pattern:

- `TaskRunsGrid.web.tsx`
- `TaskRunsGrid.tsx`

Where the native version can render a basic list until parity is worthwhile.

## Design direction

The visual additions should follow the newer chat direction:

- rounded, inviting, bubbly shapes
- neon-green accents from login rather than generic blue
- motion concentrated in entry states, transitions, and hovers
- dense work surfaces remain calmer and flatter

The mistake to avoid is mixing enterprise table UI and high-motion marketing effects on the same screen.

## File-level adoption map for Claude

### Chat

- [src/screens/circles/tabs/chat/ChatTabShell.tsx](/Users/cswanson/the-underground-circle/src/screens/circles/tabs/chat/ChatTabShell.tsx)
- add `kbar` hooks, animated prompt chips, empty-state reveal text, hover cards

### Rooms

- [src/screens/circles/tabs/RoomsTab.tsx](/Users/cswanson/the-underground-circle/src/screens/circles/tabs/RoomsTab.tsx)
- add `react-complex-tree` for file navigation
- add calmer React Bits-inspired shell motion
- optionally add a command entry to open room actions

### Feed

- [src/screens/circles/tabs/FeedTab.tsx](/Users/cswanson/the-underground-circle/src/screens/circles/tabs/FeedTab.tsx)
- add stories rail
- add one operational Data Grid view

### Circle shell

- [src/screens/circles/CircleDetailScreen.tsx](/Users/cswanson/the-underground-circle/src/screens/circles/CircleDetailScreen.tsx)
- mount `KBarProvider.web`

### Wallet / Billing

- [src/screens/wallet/WalletDashboard.tsx](/Users/cswanson/the-underground-circle/src/screens/wallet/WalletDashboard.tsx)
- only add card UI if billing is real in this phase

### Content builder

- add new `CirclePageBuilderScreen.web.tsx`
- integrate from Circle settings or profile customization

## Proposed repo additions

```text
src/components/command/
src/components/grids/
src/components/motion/
src/components/puck/
src/components/rooms/
src/components/stories/
src/components/web-effects/
src/components/billing/
src/screens/circles/CirclePageBuilderScreen.web.tsx
```

## PR plan for Claude

### PR1

- Add `kbar`
- Add web-only room file tree using `react-complex-tree`
- Add login/chat visual effects wrappers

Acceptance criteria:

- command palette opens with `cmd+k` on web
- Rooms file tree supports keyboard navigation on web
- chat or login gets one polished neon hero/effect treatment without breaking mobile

### PR2

- Add one `MUI X Data Grid` operational table
- Add stories rail in Feed

Acceptance criteria:

- users can sort/filter a real grid on web
- stories can render agent or user highlights from live data

### PR3

- Add Puck-based page builder
- add billing card modal only if payment backend exists

Acceptance criteria:

- admins can compose and save a page with reusable blocks
- payment UI is not shipped without a real backend path

## Risks and cautions

- visual-library sprawl is a bigger risk than lack of UI variety
- do not let Tailwind/shadcn assumptions leak into the whole app
- do not make mobile carry web-only dependency weight without fallbacks
- do not add payment UI without payment operations
- do not introduce advanced data grids where a simple list is enough

## Final recommendation to Claude

Implement all requested libraries, but not symmetrically.

Use each library where it naturally fits:

- command palette for app navigation
- tree for Rooms
- grid for ops data
- Puck for composed pages
- stories for short-form engagement
- payment card UI only for billing
- visual effects and animated primitives for the welcoming top layer of the product

That gives the app more polish, more power, and more product depth without turning the codebase into a pile of mismatched UI frameworks.

## Sources

- MUI X Data Grid: https://mui.com/x/react-data-grid/
- Puck docs: https://puckeditor.com/docs
- React Bits installation docs: https://pro.reactbits.dev/docs/installation
- react-complex-tree: https://github.com/lukasbach/react-complex-tree
- kbar: https://github.com/timc1/kbar
- react-insta-stories: https://github.com/mohitk05/react-insta-stories
- react-credit-cards: https://github.com/amarofashion/react-credit-cards
- Aceternity UI: https://ui.aceternity.com/

## Research gap

I did not find a clearly canonical official library source for the exact name `Acuity UI Effects`. The recommendation above therefore treats that request as Aceternity-style visual effects, which matches the features you listed much more closely than a verifiable `Acuity UI` package.
