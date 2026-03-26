# Gemini.md — The Underground Circle

> Project context and engineering standards for Gemini CLI.
> Derived from CLAUDE.md (v3).

## Project Overview
**The Underground Circle** is a social accountability platform for AI-agent builders. It features real-time agent tracking, shared offices (pixel art), and gamified accountability rituals.

## Tech Stack
- **Frontend:** React Native + Expo 54 (Web/iOS/Android), TypeScript, React 19.
- **Backend:** Supabase (Auth, Postgres, Realtime, Edge Functions).
- **AI:** OpenClaw, Claude (via Anthropic API), Gemini (API key supported).
- **Crypto:** ethers.js, @solana/web3.js.
- **Proxy:** `openclaw-proxy.js` (port 18790).

## Core Dev Commands
- `npm run web`: Start web development server (localhost:8081).
- `npm run start`: Start Expo dev server for all platforms.
- `npm run build`: Production web build.
- `npm run dev`: Custom development script.
- `npm run proxy`: Start CORS/WS proxy.
- `npm run generate-sprites`: Generate pixel art PNGs.

## Engineering Standards & Critical Guarantees

### Web Stability (CRITICAL)
- **Animation Patch:** `src/lib/animationPatch.ts` MUST be the first import in `App.tsx`. It disables `Animated.loop` and forces `useNativeDriver: false` on web to prevent infinite re-render crashes.
- **Supabase Singleton:** Access the Supabase client via `globalThis.__supabaseClient` (defined in `supabase.ts`) to avoid duplicate client warnings during HMR.
- **Auth Safety:** ALL `supabase.auth.getUser()` and `getSession()` calls MUST include a `.catch()` handler to prevent `AbortError` crashes.
- **Supabase Web Lock:** Use the no-op lock configuration in `supabase.ts` for web to avoid `navigator.locks` issues.

### UI & Animation
- **Pixel Agent Breathing:** Use `scaleX` for breathing animations. DO NOT use `scaleY` as it causes vertical jitter (legs pushing down).
- **Pointer Events:** On RN Web, use `el.addEventListener('pointerdown')` within a `useEffect` instead of the `onPointerDown` React prop.
- **Grid Snapping:** Office furniture uses a 16px grid.

### TypeScript & Schema Gotchas
- **Profiles:** When joining `profiles`, select `display_name` and `username`. The `profiles` table does NOT have an `email` column (use `auth.users`).
- **XP Table:** `user_xp` primary key is `user_id`, NOT `id`.
- **Agents Table:** `circle_office_agents` has no `model` column. The owner foreign key is `owner_id`.
- **Message Types:** `room_messages.message_type` must be one of: `chat | agent_output | edit_event | system | playground`.
- **Safe-to-ignore TS Errors:** Known issues exist in `ProfileScreen.tsx`, `OfficeChat.tsx`, `PhotonProofCheck.tsx`, and `CostDashboard.tsx`.

## Key Directory Structure
- `src/screens/`: Auth, Circles (Chat, Office, Rooms, Proof, Leaderboard).
- `src/components/`: PixelOfficeCanvas, AgentActivityFeed, HITL banners.
- `src/lib/`: `supabase.ts`, `gamification.ts`, `animationPatch.ts`.
- `supabase/migrations/`: SQL schema updates (Check CLAUDE.md for "NOT YET RUN" status).

## Workflow Guidelines
- **Research first:** Check `CLAUDE.md` and `MEMORY.md` for recent architectural shifts.
- **Validation:** Always verify changes against the web platform's unique constraints (animations, auth locks).
- **Environment:** Ensure `.env` contains `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_ANON_KEY`, and `EXPO_PUBLIC_GEMINI_API_KEY`.
