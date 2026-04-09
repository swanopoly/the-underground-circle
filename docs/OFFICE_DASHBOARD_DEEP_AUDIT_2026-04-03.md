# Office Dashboard Deep Audit

Date: 2026-04-03
Reviewer: Codex
Scope: `OfficeTab`, Office terminal transport, Office persistence, Office settings/customization, and Office-rendering files directly involved in the dashboard.

This is a findings-first handoff for implementation. I did not apply fixes in this pass.

## Summary

The Office dashboard has one clear execution bug, two real secret-handling problems, one persistence race, two stale-subscription/state bugs, and multiple Office-adjacent TypeScript build failures.

I also ran:

```bash
npx tsc --noEmit --skipLibCheck
```

The repo has many unrelated type errors, but the Office surface itself currently contributes build failures that should be fixed before relying on CI as a safety net.

## Findings

### 1. High: terminal commands can execute twice for the sender's own agents

Evidence:

- `src/components/OfficeTerminal.tsx:1689-1719` sends the command and then immediately calls `onCommandSent(...)` for direct local invocation.
- `src/lib/officeTerminal.ts:151-168` also broadcasts the same command.
- `src/lib/officeTerminal.ts:186-188` subscribes with `broadcast.self = true`.
- `src/screens/circles/tabs/OfficeTab.tsx:566-655` listens to that broadcast and invokes the same agents again.
- `src/screens/circles/tabs/OfficeTab.tsx:500-559` already performed the direct invocation path.

Impact:

- Commands from a user to their own agents can be executed twice.
- That can duplicate writes, duplicate side effects, double token spend, and produce confusing duplicate responses.

Why this happens:

- The sender-side optimization and the broadcast listener are both active for the same command path.
- Because the broadcast channel includes self events, the originating client receives the command it already executed locally.

Fix direction:

- Pick one execution path per command.
- Easiest fix: keep direct local invocation and ignore self-originated broadcast commands in `OfficeTab`.
- Alternative: remove direct invocation and rely only on broadcast, but that will increase latency.

### 2. High: Office connection secrets are stored in plaintext locally and in Supabase

Evidence:

- `src/lib/storage.ts:12-39` uses raw `localStorage` on web.
- `src/lib/connectionManager.ts:66-68` writes full connection objects to local storage.
- `src/lib/connectionManager.ts:79` stores `conn.token` directly in `api_key_hash` even though the field name implies a hash.
- `src/lib/connectionManager.ts:97-105` reads that same value back as the active token.

Impact:

- OpenSwan/API credentials are recoverable from browser storage and from the `agents_bots` table as plaintext.
- Any XSS, compromised browser profile, or accidental database exposure leaks working credentials immediately.

Fix direction:

- Do not persist raw secrets in `localStorage`.
- Use secure storage where available, or move secret handling server-side and store only opaque references client-side.
- Rename `api_key_hash` usage or stop writing plaintext to it; right now the schema name is actively misleading.

### 3. High: Telegram bot token is also stored in plaintext, and “disconnect” does not remove it

Evidence:

- `src/screens/circles/tabs/OfficeTab.tsx:920-922` saves `{ botToken, chatId }` to local storage and to `profiles.office_preferences`.
- `src/screens/circles/tabs/OfficeTab.tsx:925-932` “disconnect” only stops the poller and clears in-memory state.
- `src/screens/circles/tabs/OfficeTab.tsx:1063-1067` reloads Telegram config from local storage on init.
- `src/screens/circles/tabs/OfficeTab.tsx:1149-1153` reloads Telegram config from `office_preferences` on init.

Impact:

- The Telegram secret persists after disconnect.
- Reopening the Office can silently rehydrate a token the user thought they removed.
- This is both a security problem and a UX trust problem.

Fix direction:

- Treat disconnect as credential revocation from the app’s perspective.
- Clear both local and remote persisted Telegram config.
- If persistence is required, move the bot token into a secure secret store and keep only metadata in `office_preferences`.

### 4. Medium: Office preference sync is vulnerable to lost updates

Evidence:

- `src/screens/circles/tabs/OfficeTab.tsx:871-886` implements preference writes as read-current JSON, merge locally, then write whole JSON back.
- That helper is called from separate flows:
  - whiteboard notes: `src/screens/circles/tabs/OfficeTab.tsx:1695-1699`
  - Telegram config: `src/screens/circles/tabs/OfficeTab.tsx:920-922`
  - agent names: `src/screens/circles/tabs/OfficeTab.tsx:2921-2925`

Impact:

- Two quick updates from different tabs/devices/components can overwrite each other.
- Example: a whiteboard note save can erase a just-saved Telegram config or agent rename if both started from stale `office_preferences`.

Additional concern:

- `src/screens/circles/tabs/OfficeTab.tsx:873-883` permanently flips `_profileHasOfficePreferences` to `false` on any select/update error for the rest of the mount, including transient failures.

Fix direction:

- Move preference merging into an atomic server-side RPC or use field-specific columns/tables instead of one shared JSON blob.
- Do not permanently disable sync on one transient request failure; retry or gate only on schema-missing errors.

### 5. Medium: key Office effects are keyed on counts, so they go stale when identities change

Evidence:

- Auto-publish effect: `src/screens/circles/tabs/OfficeTab.tsx:706-721` depends on `connections.filter(...).length`.
- Terminal subscription effect: `src/screens/circles/tabs/OfficeTab.tsx:566-656` depends on `circleOfficeAgents.filter(...).length`.

Impact:

- If one connected agent is replaced by another and the count stays the same, the effect does not rerun.
- Result:
  - newly connected agents may not auto-publish to the circle office
  - command subscriptions may keep listening to stale agent IDs and miss new ones

Fix direction:

- Depend on a stable identity signature, not just counts.
- Example: derive a memoized string of relevant connection IDs / agent IDs and use that in the dependency array.

### 6. Medium: Office-specific TypeScript errors are already present

Evidence from `npx tsc --noEmit --skipLibCheck`:

- `src/screens/circles/tabs/office/CustomizePanel.tsx:1859`
  - accesses `supabase.supabaseUrl`, which is a protected property.
- `src/screens/circles/tabs/office/OfficeChat.tsx:189`
  - status map omits `'building'`, but `OfficeAgent.status` includes it.
- `src/screens/circles/tabs/office/OfficeFloor.tsx:1025`
  - references `s.windowArea`, which does not exist in the style object.

Impact:

- The Office area is already outside the type-safe path.
- That makes future refactors riskier and weakens CI as a regression detector.

Fix direction:

- Fix these Office-local errors first, then re-run typecheck with Office files as a minimum gate.
- After that, consider a targeted Office `tsc` or lint gate if full-repo typecheck is still noisy.

## Suggested Fix Order

1. Stop duplicate terminal execution.
2. Remove plaintext secret persistence for connections and Telegram.
3. Make Telegram disconnect actually delete persisted credentials.
4. Replace the JSON read-modify-write preference flow with an atomic update path.
5. Fix stale effect dependencies for auto-publish and command subscription.
6. Clean up the Office-local TypeScript errors.

## Notes

- I intentionally prioritized correctness, security, and regression risk over style or architectural cleanliness.
- There is more maintainability debt in `src/screens/circles/tabs/OfficeTab.tsx` due to size and mixed responsibilities, but the items above are the ones most worth fixing first.
