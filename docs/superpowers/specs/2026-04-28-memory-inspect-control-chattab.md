# ChatTab wiring patch — Plan A Phase 2

Companion patch for the citation-pill linkage. Held separately because
`src/screens/circles/tabs/ChatTab.tsx` had unrelated in-progress
modifications at the time Plan A's substrate was committed; bundling them
would have conflated two scopes.

## What it does

1. **Refactors `addUserMessage`** to return `{ message, dbIdPromise }`
   instead of just the message — exposing the persistence promise so
   the caller can read the resolved `dbId` once it lands.
2. **Captures the persistence promise** in `sendMessage` as
   `triggerMessageIdPromise` for the rest of the turn.
3. **Races persistence against a 750 ms ceiling** before invoking the
   AI. If persistence wins, `triggerMessageId` is passed to
   `buildStreamableSystemPrompt` → propagates into `retrieveForTurn` →
   ends up on `memory_access_log.message_id`. If the ceiling wins, the
   call still proceeds, just without the linkage (graceful degrade).
4. **Backfills `assistant_message_id`** in the streaming-path
   `onPersisted` callback by calling
   `attachAssistantMessageToMemoryAccess` once the bot reply hits the DB.
5. **Passes `assistantMessageDbId`** to the existing `MessageCitations`
   component so it prefers the new `get_memory_citations` RPC over the
   timestamp-window fallback.

The non-streaming batch path is intentionally not wired in this patch
— all heavy chat traffic runs the streaming path (see `canStream`
gate). Wiring `runOpenSwanSessionTurn` is a follow-up if the citation
pill ever needs to attach to slow / parallel-delegation runs.

## How to apply

```bash
cd /path/to/the-underground-circle
git apply docs/superpowers/specs/2026-04-28-memory-inspect-control-chattab.patch
```

If you have rebased the branch and the line numbers drift, fall back to:
```bash
git apply --3way docs/superpowers/specs/2026-04-28-memory-inspect-control-chattab.patch
```

After applying, run `npm run typecheck:app` to confirm.

## What it depends on

- `supabase/migrations/20260428_memory_inspect_control.sql` must be
  applied to the database (adds `message_id`, `assistant_message_id`,
  and the `get_memory_citations` RPC).
- The library changes in commit `18aa25f` must already be present
  (they expose `attachAssistantMessageToMemoryAccess`,
  `loadCitationsByAssistantMessage`, the `triggerMessageId` parameter
  on `buildStreamableSystemPrompt`, etc.).

## What it does NOT do

- Does not touch `runOpenSwanSessionTurn` (the non-streaming batch
  path). Action-intent and parallel-delegation messages will still
  fall back to timestamp-window matching for their citation pills.
- Does not affect the room-chat / agent-dispatch paths — those have
  their own message persistence flows that would need the same
  treatment if the pill is wanted there.
