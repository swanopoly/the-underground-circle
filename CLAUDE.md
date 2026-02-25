# CLAUDE.md — The Underground Circle

Comprehensive guide for AI assistants working in this codebase.

---

## Project Overview

**The Underground Circle** is a social accountability platform built with React Native + Expo. Users join small "circles" to track goals, check in daily, manage AI agents, connect crypto wallets, and compete via gamification. The app runs on iOS, Android, and Web (deployed to [app.chrisswanson.xyz](https://app.chrisswanson.xyz)).

**Tech Stack:**
- React Native 0.81.5 + Expo 54 + React 19
- TypeScript 5.9 (strict mode)
- Supabase (PostgreSQL, Realtime, Auth, Edge Functions)
- ethers.js v6 (Ethereum) + @solana/web3.js (Solana)
- React Navigation 7 (native stack)
- Netlify (web deploy), Expo EAS (mobile builds)

---

## Repository Structure

```
/
├── App.tsx                  # Root component — auth state, splash screen
├── index.ts                 # Expo registerRootComponent
├── app.json                 # Expo config (dark theme, splash, icons)
├── package.json             # Dependencies & scripts
├── tsconfig.json            # Extends expo/tsconfig.base, strict: true
├── netlify.toml             # Web deployment + security headers + CSP
├── openclaw-proxy.js        # CORS proxy for local AI agent gateway (port 18790→18789)
├── start-dev.js             # Supervisor daemon: auto-restarts expo + proxy on crash
├── supabase-schema.sql      # Base schema definition (initial tables)
├── supabase-migration-add-messages-tasks.sql
│
├── src/
│   ├── types/index.ts       # ALL shared TypeScript interfaces (single source of truth)
│   ├── hooks/
│   │   ├── useAuth.ts       # Auth state hook (session, user, signIn/signUp/signOut)
│   │   └── useOptimizedQuery.ts
│   ├── lib/                 # 34 service/utility modules (no UI)
│   │   ├── supabase.ts      # Supabase client (platform-aware storage)
│   │   ├── agents.ts        # Agent CRUD (agents_bots table)
│   │   ├── gamification.ts  # XP math, level calculation, awardXP()
│   │   ├── crypto.ts        # Wallet ops, chain configs, RPC fallbacks
│   │   ├── governance.ts    # Proposals, voting, polls
│   │   ├── discord.ts       # Discord API integration
│   │   ├── openclawService.ts # OpenClaw AI gateway client
│   │   ├── officeConfig.ts  # Office themes, floor layout
│   │   ├── officeAgents.ts  # Office state management
│   │   ├── costCalculations.ts # Agent cost analytics
│   │   ├── validation.ts    # Input validation
│   │   ├── storage.ts       # AsyncStorage helpers
│   │   └── ...
│   ├── components/          # 19 reusable components
│   │   ├── ErrorBoundary.tsx
│   │   ├── Button.tsx / Card.tsx / PageContainer.tsx / PixelButton.tsx
│   │   ├── CostDashboard.tsx / AgentPerformanceMetrics.tsx / FarmHealthDashboard.tsx
│   │   ├── ProposalCard.tsx / NorthStarJournal.tsx
│   │   └── ...
│   ├── navigation/
│   │   ├── AuthNavigator.tsx  # Login + SignUp stack
│   │   └── MainNavigator.tsx  # Full app stack (all screens post-auth)
│   ├── screens/
│   │   ├── circles/
│   │   │   ├── CirclesScreen.tsx        # Home — list/create/join circles
│   │   │   ├── CircleDetailScreen.tsx   # 9-tab circle view (MOST COMPLEX FILE)
│   │   │   ├── CreateCircleScreen.tsx
│   │   │   ├── JoinCircleScreen.tsx
│   │   │   ├── CircleSettingsScreen.tsx
│   │   │   └── tabs/
│   │   │       ├── ChatTab.tsx          # Real-time circle chat
│   │   │       ├── FeedTab.tsx          # Activity feed + task board
│   │   │       ├── MembersTab.tsx       # Member list
│   │   │       ├── OfficeTab.tsx        # AI agent management dashboard
│   │   │       ├── WalletTab.tsx        # Crypto portfolio
│   │   │       ├── ProfileTab.tsx       # Member profile
│   │   │       ├── ChallengesTab.tsx    # Streak/goal challenges
│   │   │       ├── DigestTab.tsx        # AI-powered summaries
│   │   │       ├── DiscordTab.tsx       # Discord bridge
│   │   │       └── office/              # Office sub-components
│   │   │           ├── OfficeFloor.tsx  # Pixel-art office layout
│   │   │           ├── OfficeChat.tsx   # Agent chat interface
│   │   │           ├── AgentPanel.tsx
│   │   │           ├── PixelAgent.tsx
│   │   │           ├── ServerRack.tsx
│   │   │           ├── Whiteboard.tsx
│   │   │           └── CustomizePanel.tsx
│   │   ├── auth/            # LoginScreen, SignUpScreen
│   │   ├── agents/          # AgentsScreen
│   │   ├── wallet/          # ConnectWalletScreen, WalletDashboard
│   │   ├── profile/         # ProfileScreen, EditProfileScreen
│   │   ├── friends/         # FriendsScreen, DMScreen
│   │   ├── integrations/    # IntegrationsScreen
│   │   └── ...
│   └── migrations/          # Local SQL migration helpers
│       └── 2026021[4-7]_*.sql
│
├── supabase/
│   ├── config.toml          # Local Supabase config (API port 54321, DB port 54322)
│   ├── migrations/          # 13 timestamped SQL migrations
│   └── functions/
│       └── swanbot-ai/      # Deno edge function for SwanBot
│
├── docs/                    # 17 markdown docs
│   ├── DEV.md               # Developer setup guide
│   ├── PRODUCTION_READY.md  # Feature status & production checklist
│   ├── OFFICE_TAB_SPEC.md   # Office feature specification
│   ├── SUPABASE_SETUP.md    # Database setup
│   └── ...
│
└── web/index.html           # Web entry HTML
```

---

## Development Commands

```bash
# Install dependencies
npm install

# Start development (recommended — runs expo + CORS proxy with auto-restart)
npm run dev

# Or start just expo
npm start        # Expo dev server (opens QR code + browser)
npm run web      # Web only (localhost:8081)
npm run android  # Android simulator
npm run ios      # iOS simulator

# Start just the CORS proxy for OpenClaw AI integration
npm run proxy    # localhost:18790 → localhost:18789

# Production web build
npm run build    # Outputs to dist/
```

---

## Environment Variables

Create a `.env` file in the project root:

```env
EXPO_PUBLIC_SUPABASE_URL=your_supabase_project_url
EXPO_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key
EXPO_PUBLIC_GEMINI_API_KEY=your_gemini_api_key
```

All keys use the `EXPO_PUBLIC_` prefix — they are safe for frontend use (public API keys only). Never add server secrets here.

For Netlify deploys, set these same three variables in **Site Settings → Environment Variables** in the Netlify UI.

---

## Architecture & Key Conventions

### TypeScript

- **Strict mode** is enabled. All types must be explicit — no `any` except where unavoidable (mark with comment).
- All shared interfaces live in **`src/types/index.ts`** — the single source of truth. Do not duplicate types.
- Screen props use `{ route, navigation }: any` by convention (React Navigation typing is verbose).
- Use `Record<string, any>` for flexible metadata fields on Supabase rows.

### Supabase Patterns

- Import the singleton client from `src/lib/supabase.ts`:
  ```typescript
  import { supabase } from '../lib/supabase';
  ```
- Always check `error` from Supabase calls before using `data`.
- RLS is active on all tables. Auth context (`auth.uid()`) is enforced server-side.
- Use `supabase.auth.getUser()` (not `getSession()`) when you need the current user ID in service functions.
- Real-time subscriptions: always return the cleanup function to unsubscribe.

### Component Patterns

- **StyleSheet.create()** is required — no inline style objects on hot paths.
- Background color is `#0a0a0a` (near-black). Accent defaults to `#6366f1` (indigo).
- Platform checks: `Platform.OS === 'web'` for web-specific branches.
- Responsive breakpoint: `winW < 700` for mobile layout (use `useWindowDimensions()`).
- All screens are wrapped in `ErrorBoundary` at the app level. Critical sub-trees should add their own.
- Loading states must always be handled — show a loading indicator or skeleton, never undefined data.

### Navigation

- Navigation stack is in `MainNavigator.tsx`. Add new screens there.
- Screen names as constants: `'CirclesList'`, `'CreateCircle'`, `'CircleDetail'`, `'Agents'`, etc.
- Pass `circleId` and `circleName` as route params to `CircleDetail`.
- All screens use `headerShown: false` — implement custom headers inside screens.

### Crypto / Wallet

- Multi-chain support: `solana`, `ethereum`, `polygon`, `base` — defined in `src/types/index.ts`.
- Chain configs (RPC URLs, explorer URLs) live in `src/lib/crypto.ts`.
- Solana uses a fallback RPC chain — always use the fallback array, not a single endpoint.
- Max transaction limits: 10 ETH, 100 SOL — enforced in `crypto.ts`.
- Wallets connect via browser extensions (MetaMask for ETH, Phantom for SOL) on web.

### Gamification (XP)

- XP formula: `level = min(floor(sqrt(xp / 50)) + 1, 100)`
- `awardXP()` calls the `award_xp` Supabase RPC — don't update `user_xp` directly.
- XP actions and amounts are defined in `src/lib/gamification.ts`:
  - login: 10, check_in: 25, task_complete: 30, circle_join: 50, circle_create: 75

### Office Tab (AI Agent Dashboard)

- The Office tab connects to a local **OpenClaw Gateway** at `localhost:18789` via CORS proxy at `localhost:18790`.
- **Production limitation**: localhost connections are skipped on production (`window.location.hostname` check). The Office tab requires users to run OpenClaw locally or configure a remote endpoint.
- Office themes live in `src/lib/officeConfig.ts`. Available themes: `underground`, `cyberpunk`, `matrix`, `minimal`.
- Sub-components are in `src/screens/circles/tabs/office/`.
- Agent connections are persisted to Supabase (`agent_connections` table) for cross-device access.

---

## Database Schema

**Core tables** (see `supabase-schema.sql` and `supabase/migrations/`):

| Table | Purpose |
|-------|---------|
| `profiles` | User profiles (extends `auth.users`) |
| `circles` | Accountability circles |
| `circle_members` | Circle membership + roles |
| `check_ins` | Daily Proof of Work (1 per user/circle/day) |
| `messages` | Circle chat (reactions as JSONB) |
| `tasks` | Circle task board |
| `user_xp` | Gamification scores |
| `achievements` / `user_achievements` | Badge system |
| `challenges` / `challenge_participants` | Circle challenges |
| `agents_bots` | AI agent registry |
| `proposals` / `proposal_votes` | Governance |
| `friends` / `friend_requests` | Social graph |
| `direct_messages` | 1:1 DMs |
| `integrations` | Third-party connections |
| `discord_servers` | Discord bridge data |
| `wallet_connections` | Wallet metadata & security |
| `photon_proofs` | Photon network proofs |

All tables have **Row-Level Security** enabled. Always write RLS-compatible queries (they work automatically via Supabase JS client with active session).

---

## Deployment

### Web (Netlify)
- Deploy triggers on push to `master`
- Build: `npm run build` → outputs to `dist/`
- Live: [app.chrisswanson.xyz](https://app.chrisswanson.xyz)
- CSP is configured in `netlify.toml` — if adding new external domains (APIs, RPC endpoints), add them to the `connect-src` directive.

### Mobile (Expo EAS)
- Not currently configured with `eas.json`
- Use `expo start --android` / `expo start --ios` for dev builds

---

## Known Issues & Gotchas

1. **Office Tab on Production**: The AI agent dashboard silently skips localhost endpoints in production. Users must either run OpenClaw locally or configure a remote/ngrok endpoint. This is the flagship feature — don't remove the production check without a proper remote solution.

2. **No test suite**: There are no Jest/Vitest tests. Be careful when refactoring shared lib functions — manual testing required.

3. **Supabase schema drift**: The code may reference columns added in migrations that aren't in `supabase-schema.sql`. Always check `supabase/migrations/` for the full current schema.

4. **RPC rate limiting**: Free Solana RPC endpoints get rate-limited. The `SOLANA_RPC_ENDPOINTS` fallback array in `crypto.ts` handles this — don't replace it with a single endpoint.

5. **Expo `newArchEnabled: true`**: The app uses React Native's New Architecture. Some third-party libraries may not be compatible.

6. **Platform-specific storage**: `src/lib/supabase.ts` uses `localStorage` on web and `AsyncStorage` on native. Don't bypass this — use the `supabase` client directly.

7. **CircleDetailScreen complexity**: `src/screens/circles/CircleDetailScreen.tsx` is the most complex file. It manages 9 tab states, circle data, and scroll behavior. Read carefully before modifying.

---

## Adding New Features

### New Screen
1. Create the component in the appropriate `src/screens/<category>/` directory.
2. Add it to `src/navigation/MainNavigator.tsx` with `<Stack.Screen>`.
3. Navigate to it with `navigation.navigate('ScreenName', { params })`.

### New Circle Tab
1. Create `src/screens/circles/tabs/YourTab.tsx`.
2. Add to the `TAB_META` array in `CircleDetailScreen.tsx`.
3. Add the render case in `CircleDetailScreen`'s tab switcher.

### New Supabase Table
1. Write a migration file in `supabase/migrations/YYYYMMDD_description.sql`.
2. Add corresponding TypeScript interface to `src/types/index.ts`.
3. Create a service module in `src/lib/yourfeature.ts` following the existing patterns.
4. Enable RLS and write appropriate policies in the migration.

### New Library Module
- Place in `src/lib/`, export typed async functions.
- Always import `supabase` from `./supabase` — never create new clients.
- Check `supabase.auth.getUser()` at the start of user-scoped operations.

---

## Git Workflow

- **Main branch**: `master`
- **Feature branches**: `claude/<description>` for AI-driven work
- Commits are descriptive, present-tense imperative ("Fix SOL balance", "Add wallet tab")
- No test scripts exist, so no pre-commit hooks to worry about
- Push web deploys automatically via Netlify on `master` push
