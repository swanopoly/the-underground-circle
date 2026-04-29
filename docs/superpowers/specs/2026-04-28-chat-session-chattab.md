# ChatTab session patch — consolidated

This patch contains all session edits to `ChatTab.tsx` from 2026-04-28:
the Plan A memory citation wiring **and** the new terminal slash
commands. It supersedes `2026-04-28-memory-inspect-control-chattab.patch`.

## What it does (12 hunks)

### Plan A — memory citation pill linkage

1. Refactor `addUserMessage` to return `{ message, dbIdPromise }` so the
   caller can read the resolved dbId for `triggerMessageId`.
2. `addBotMessage` signature gains `terminalResult?: TerminalRunResult`
   (also covers Plan A's existing extra fields).
3. Capture `triggerMessageIdPromise` in `sendMessage` from
   `addUserMessage`'s return.
4. Race persistence vs. 750ms ceiling, pass `triggerMessageId` to
   `buildStreamableSystemPrompt`.
5. `onPersisted` fires `attachAssistantMessageToMemoryAccess` once the
   bot reply hits the DB.
6. `MessageCitations` gets `assistantMessageDbId={item.dbId}` so it
   prefers the new `get_memory_citations` RPC over timestamp matching.

### Terminal commands — `/run`, `/sh`, `/cd`, `/pwd`

7. New imports: `TerminalOutputCard`, `MessageRunButtons`,
   `executeTerminalCommand`, `parseTerminalCommand`, `TerminalRunResult`.
8. `ChatMessage` gains `terminalResult?: TerminalRunResult`.
9. `addBotMessage` extra propagates `terminalResult`.
10. New slash intercept early in `sendMessage`: detects /run /sh /cd
    /pwd and routes through `executeTerminalCommand`. Output renders as
    a local-only message — never persisted to Supabase.
11. `<TerminalOutputCard />` renders under bot messages whose
    `terminalResult` is set.
12. `<MessageRunButtons />` renders under bot replies that contain
    detected shell commands (fenced ```bash blocks or inline shelly
    code). One-tap RUN per command, output stays local.

## How to apply

```bash
cd /path/to/the-underground-circle
git apply docs/superpowers/specs/2026-04-28-chat-session-chattab.patch
```

If your working tree has the existing `feat/hybrid-computer-task`
branch tip exactly, the patch applies cleanly. The hunks at lines
~501, ~2453, ~2491, and ~4706 share context with the in-progress
`fileTaskResult` / `fileTaskToolName` / computer-use changes already on
this branch — that's intentional, not a bug.

If `git apply` fails:
```bash
git apply --3way docs/superpowers/specs/2026-04-28-chat-session-chattab.patch
```

After applying, run `npm run typecheck:app` to confirm.

## Dependencies

- DB migration `20260428_memory_inspect_control.sql` must be applied
  (citation pill RPC).
- Library commits already on this branch must be present:
  - `18aa25f` — Plan A substrate (memoryService, memoryActions,
    swanbot, MessageCitations)
  - this session's terminal commit — `terminalChatCommands.ts`,
    `chatCommandRegistry.ts` updates, `TerminalOutputCard.tsx`
- claude-bridge must be running locally for `/run` to actually execute
  commands (`npm run bridges:up` or `node scripts/claude-bridge.js`).

## What it does NOT do

- Does not wire `runOpenSwanSessionTurn` (the non-streaming batch
  path). Action-intent and parallel-delegation runs still fall back to
  timestamp-window matching for memory citations.
- Does not add the AI-side `run_shell` tool with confirmation prompt —
  that's a future enhancement so BlackSwan can request a shell command
  on the user's behalf with explicit approval.
- Does not wire `/run` into room-chat surfaces — only main circle chat.
