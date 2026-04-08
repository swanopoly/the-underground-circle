# MorningRoutineScreen Audit
Source: `src/screens/morning/MorningRoutineScreen.tsx`
Last audited: 2026-04-03
Status: Watch.

## Findings
- Low: the greeting helper creates a `supabase.auth.getUser()` promise and never uses it. See `src/screens/morning/MorningRoutineScreen.tsx:145-148`. That is harmless today but signals dead logic inside a user-facing path.

