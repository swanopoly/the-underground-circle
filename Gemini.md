# Gemini.md - The Underground Circle

> Gemini CLI notes.
> Last reviewed: 2026-05-09

Start with `AGENTS.md`, then `docs/AGENTS_ROADMAP.md`. This file is only the
Gemini-specific quick sheet.

## Project Snapshot

- Frontend: Expo 54, React Native 0.81.5, React 19, TypeScript.
- Backend: Supabase Auth, Postgres, Realtime, Edge Functions.
- AI/runtime: BlackSwan, OpenSwan, Claude Code/Codex bridges, provider
  marketplace, Browserbase Computer Use, local desktop bridge tools.
- LLM providers: Anthropic, OpenAI, OpenRouter, Hugging Face, Groq, Google AI,
  Mistral, Cohere, Perplexity, Together, Fireworks, DeepSeek, z.ai, MiniMax,
  Ollama, GitHub Models, and related marketplace integrations.
- Web deploy: Netlify. Local app dev server: `http://localhost:8081`.

## Read Before Editing

- `docs/AGENTS_ROADMAP.md` - ownership, phase status, SQL checklist, rules.
- `docs/UC_APP_STACK_REFERENCE.md` - current app map.
- `CLAUDE.md` - current product and architecture context.
- `MEMORY.md` - persistent gotchas.

## Non-Negotiables

- `src/lib/animationPatch.ts` stays first in `App.tsx`.
- Use `src/lib/supabase.ts`; do not create another Supabase client on the
  frontend.
- Prefer `safeGetUser`, `safeGetSession`, and `getFreshAccessToken`.
- Do not add new unguarded `supabase.auth.getUser()` / `getSession()` calls.
- On React Native Web, prefer native DOM pointer listeners when React pointer
  props are unreliable.
- Office furniture and draggable office placement stay on the 16px grid.
- Do not assume `profiles.email`, `circle_office_agents.model`, or
  `user_xp.id` exist.

## Validation

Run `npm run typecheck` after TypeScript-heavy changes.

For focused runtime work, prefer the matching smoke script in `package.json`;
examples:

```bash
npm run smoke:chat-planner
npm run smoke:computer-task-runtime
npm run smoke:cross-provider-router
npm run smoke:agent-runtime
```

Do not rely on old ignored-TypeScript-error guidance. The current baseline
typecheck is expected to be clean.
