# CLAUDE.md — The Underground Circle

## Project Overview

Social accountability circles app with AI agents, crypto wallets, and gamification.

- **Live URL:** https://app.chrisswanson.xyz
- **Repo:** https://github.com/swanopoly/the-underground-circle

## Tech Stack

- **Frontend:** React Native + Expo (targets Web, iOS, Android)
- **Backend:** Supabase (Auth, Postgres, Realtime, Edge Functions)
- **AI:** OpenClaw multi-agent integration
- **Crypto:** ethers.js (Ethereum) + @solana/web3.js (Solana)
- **Deploy:** Netlify (web), Expo EAS (mobile)

## Project Structure

```
src/
  screens/       # Screen components (auth/, circles/, agents/, wallet/, etc.)
  components/    # Shared UI components
  lib/           # Core utilities (supabase.ts, agents.ts, gamification.ts, etc.)
  hooks/         # React hooks (useAuth.ts, useOptimizedQuery.ts)
  navigation/    # AuthNavigator.tsx, MainNavigator.tsx
  services/      # Business logic services
  types/         # TypeScript type definitions
supabase/
  functions/     # Edge Functions (room-task-executor, swanbot-ai)
  migrations/    # DB migrations
```

## Dev Commands

```bash
npm run web      # Web dev server (localhost:8081)
npm run start    # Expo dev server
npm run build    # Production web build (expo export --platform web)
npm run dev      # Custom dev script (start-dev.js)
npm run proxy    # OpenClaw proxy server
```

## Environment Variables

Required in `.env`:
```
EXPO_PUBLIC_SUPABASE_URL=
EXPO_PUBLIC_SUPABASE_ANON_KEY=
EXPO_PUBLIC_GEMINI_API_KEY=
```

## Key Files

- `src/lib/supabase.ts` — Supabase client (platform-aware storage: localStorage on web, AsyncStorage on native)
- `src/lib/agents.ts` / `src/lib/openclawService.ts` — AI agent management
- `src/lib/gamification.ts` — XP, levels, badges, challenges
- `src/lib/crypto.ts` — Wallet utilities
- `src/navigation/AuthNavigator.tsx` — Auth flow (Login/SignUp)
- `src/navigation/MainNavigator.tsx` — Main app tabs
- `supabase/functions/` — Edge Functions for AI task execution

## Architecture Notes

- Auth is handled via Supabase Auth with session persistence
- Web uses `localStorage`, native uses `AsyncStorage` for session storage
- AI agents run via OpenClaw with a local proxy (`openclaw-proxy.js`) in dev
- Heavy agent tasks execute in Supabase Edge Functions to avoid client-side cost
- The pixel-art office canvas (`PixelOfficeCanvas.tsx`) is the AI agent management UI
