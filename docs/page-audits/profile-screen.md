# ProfileScreen Audit
Source: `src/screens/profile/ProfileScreen.tsx`
Last audited: 2026-04-03
Status: Watch.

## Findings
- Medium: profile mutation flows optimistically update local UI without checking Supabase write results. See `src/screens/profile/ProfileScreen.tsx:189-198` and `src/screens/profile/ProfileScreen.tsx:195-201`. Failures can leave the UI inconsistent with the backend.
- Low: the initial load path chains many reads and side effects without central error handling. See `src/screens/profile/ProfileScreen.tsx:112-173`. That makes partial-load failures hard to detect and debug.

