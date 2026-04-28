# Memory Inspect & Control — Design

> **Goal:** Close Phase 5 of `AGENT_MEMORY_GOD_PLAN.md` and add reinforcement
> scoring. Make the memory layer auditable, editable, and trustworthy from
> the user's perspective. Map directly to Mercury article's "Inspectable",
> "Conflict Resolution", and "Scoring" pillars.
>
> Status: planning · Date: 2026-04-28 · Owner: Swan

---

## 1. Why this, why now

UC's memory infrastructure is ~85% built (semantic retrieval, soul-weighting,
age decay, contradiction detection helper, embedding backfill). What's
missing is the *user-facing trust loop*: the user can't see which memories
shaped a reply, can't reinforce or correct them in flight, and can't see
the health of the store at a glance.

The Mercury article published 2026-04-27 makes this gap publicly visible
— "Inspectable" is one of their named pillars. UC has the substrate; this
spec turns it into a felt feature.

---

## 2. Current state (evidence)

| Capability                              | State          | File                                    |
| --------------------------------------- | -------------- | --------------------------------------- |
| `memory_access_log` table + RLS         | Shipped        | `supabase/migrations/20260408_memory_v2_retrieval_privacy.sql:150` |
| Access log written on every retrieval   | Shipped        | `src/lib/memoryService.ts:999`          |
| `MemoryHealthCard` (full-featured)      | Built, unwired | `src/components/agent/MemoryHealthCard.tsx` |
| `MemoryViewer` with pin/forget actions  | Shipped        | `src/components/agent/MemoryViewer.tsx` + `src/lib/memoryActions.ts` |
| `detectContradictions` helper           | Shipped        | `src/lib/memoryConsolidation.ts:97`     |
| Daily contradiction cron                | Pending        | no edge fn `consolidate-memories`       |
| Citation pill ("Used N memories")       | **Pending**    | —                                       |
| Reinforcement counter                   | **Pending**    | no `reinforcement_count` column         |
| `message_id` linkage on access log      | **Pending**    | only `run_id` recorded today            |

The pending rows are the scope of this spec.

---

## 3. Design

### 3.1 Schema deltas

```sql
-- Migration: 20260428_memory_inspect_control.sql

-- Per-message audit linkage (current schema only has run_id)
alter table memory_access_log
  add column message_id uuid references messages(id) on delete cascade;
create index idx_memory_access_log_message
  on memory_access_log(message_id) where message_id is not null;

-- Reinforcement signal — increments when user accepts an answer that cited
-- this memory; decrements / contradicts when user disputes it.
alter table memory_entries
  add column reinforcement_count int not null default 0,
  add column dispute_count int not null default 0,
  add column last_reinforced_at timestamptz;
create index idx_memory_entries_reinforcement
  on memory_entries(reinforcement_count desc) where is_active;

-- Reasons we now write
alter table memory_access_log
  drop constraint memory_access_log_reason_check;
alter table memory_access_log
  add constraint memory_access_log_reason_check
  check (reason in (
    'startup','retrieval','session_resume','manual_pin','search',
    'reinforce','dispute','forget'  -- new
  ));
```

### 3.2 Components

**`MemoryCitationPill`** (new, `src/components/agent/MemoryCitationPill.tsx`)
- Renders below assistant messages: `Used 4 memories ▾`
- Tap expands inline: list of titles with importance bar, soul tag, and
  per-memory reinforce / dispute / view buttons.
- Reads from `memory_access_log` filtered by `message_id`.
- Empty state: don't render the pill at all (zero noise).

**`useMemoryCitations(messageId)` hook** (new, `src/lib/useMemoryCitations.ts`)
- Subscribes to `memory_access_log` rows where `message_id = X`.
- Joins `memory_entries` for title + score + scope + soul links.
- Returns `{ count, memories, isLoading }`.

**`reinforceMemory(id)` / `disputeMemory(id)` actions** (extend `memoryActions.ts`)
- `reinforceMemory`: `reinforcement_count += 1`, `last_reinforced_at = now()`,
  `importance = min(1.0, importance + 0.05)`. Write `reason='reinforce'`
  to access log.
- `disputeMemory`: `dispute_count += 1`, `importance = max(0.0, importance - 0.10)`.
  If `dispute_count >= 3` and `dispute_count > reinforcement_count`, set
  `is_active = false` (auto-quarantine). Log `reason='dispute'`.

**Retrieval scoring update** (`memoryService.ts:retrieveForTurn`)
- Add reinforcement boost to scoring step 3:
  `+ 0.15 * tanh(reinforcement_count / 5)` (saturates ~0.15 at heavy use)
  `- 0.20 * tanh(dispute_count / 3)` (saturates ~-0.20 at heavy dispute)

**`MemoryHealthCard` placement**
Component is already built and unused. Place it in two locations:
1. Control Panel diagnostics tab (primary diagnostic surface).
2. Office tab → existing Memory section in mobile view (collapsible).

### 3.3 Data flow — citation linkage

```
User sends message M
   │
   ▼
swanbot.ts:retrieveForTurn(messageId=M.id)
   │  retrieves 6 of 40 candidates
   ▼
memory_access_log INSERTs (memory_id, run_id, message_id=M.id, reason='retrieval')
   │
   ▼
Assistant renders message A (replying to M)
   │
   ▼
ChatTab renders <MemoryCitationPill messageId={A.id} />
   │
   ├─ if access_log rows exist with message_id=A.id → "Used N memories"
   └─ user taps → expand → reinforce/dispute/view
```

**Subtlety:** `memory_access_log` is keyed by the *triggering user message*
ID today. The pill needs to attach to the *assistant reply* visually but
look up by the user's message. Two options:

- **Option α (chosen):** Write `message_id = userMsgId` *and* later
  `assistant_message_id` once the reply is persisted. Backfill in the
  same write transaction the assistant message goes through.
- Option β: Just key by user message ID, render pill on user-message
  side. Looks weird — feedback should be on the answer, not the question.

Implementation: extend the swanbot reply persistence path to UPDATE
the access_log rows for that turn with the assistant's message_id once
the reply is saved.

### 3.4 UI sketch

```
┌─ Assistant message ────────────────────────────────────────────┐
│ Yes, the migration is safe — past Q1 incident showed the lock  │
│ release happens before the backfill begins. I'd still ship at  │
│ 3am UTC to minimize concurrent writes.                          │
│                                                                  │
│ Used 4 memories ▾                                                │
│   ◆ Q1 migration incident — backfill order   importance ▰▰▰▰░ │
│     ↑ reinforce     ↓ dispute     view                           │
│   ◆ Prefer 3am UTC for risky deploys         importance ▰▰▰░░ │
│     ↑ reinforce     ↓ dispute     view                           │
│   …                                                              │
└─────────────────────────────────────────────────────────────────┘
```

### 3.5 Non-goals

- Building a separate "memory wiki" surface — that's Plan C.
- Public-facing positioning copy — that's Plan B.
- Citation graphs / cross-memory link visualization — defer.

---

## 4. Phased rollout

### Phase 1 — Schema + linkage (½ day)
- New migration: `message_id`, `reinforcement_count`, `dispute_count`, new reasons.
- Update `memoryService.retrieveForTurn` to accept and write `messageId`.
- Backfill assistant `message_id` in `swanbot.ts` after reply persisted.
- **Exit:** new turns produce access-log rows with both message ids; SQL
  query returns "memories used for message X."

### Phase 2 — Citation pill UI (1 day)
- `MemoryCitationPill` + `useMemoryCitations` hook.
- Wire into `ChatTab` message renderer for assistant rows.
- Per-memory reinforce / dispute buttons → `memoryActions`.
- Extend retrieval scoring with reinforcement boost.
- **Exit:** user can see "Used N memories" under any reply, expand it,
  reinforce or dispute, and the next retrieval reflects the change.

### Phase 3 — Surface MemoryHealthCard (½ day)
- Place in Control Panel diagnostics tab (primary).
- Place collapsed in Office mobile memory section (secondary).
- Add a subtle "↗ memory health" link from the citation pill expansion.
- **Exit:** users encounter the health card naturally during normal use.

### Phase 4 — Daily contradiction cron (½ day, optional)
- New edge fn `consolidate-memories` calling `detectContradictions` over
  last 24h of new memories.
- pg_cron schedule daily at 3am UTC.
- **Exit:** GOD_PLAN Phase 4 fully shipped (cron was the missing piece).

Total: **~2.5 focused days.**

---

## 5. File-level delta map

| File                                                    | Change                            | Phase |
| ------------------------------------------------------- | --------------------------------- | ----- |
| `supabase/migrations/20260428_memory_inspect_control.sql` | NEW — schema                    | 1     |
| `src/lib/memoryService.ts`                              | accept `messageId`; reinforce score | 1+2 |
| `src/lib/swanbot.ts`                                    | backfill assistant message_id     | 1     |
| `src/lib/memoryActions.ts`                              | `reinforceMemory`, `disputeMemory` | 2     |
| `src/lib/useMemoryCitations.ts`                         | NEW — hook                        | 2     |
| `src/components/agent/MemoryCitationPill.tsx`           | NEW — component                   | 2     |
| `src/screens/circles/tabs/ChatTab.tsx`                  | render pill under assistant rows  | 2     |
| `src/screens/circles/tabs/office/AgentMemoryPanel.tsx`  | embed `MemoryHealthCard`          | 3     |
| (Control Panel diagnostics)                             | embed `MemoryHealthCard`          | 3     |
| `supabase/functions/consolidate-memories/index.ts`      | NEW — cron edge fn                | 4     |

---

## 6. Risks

| Risk                                                | Mitigation                                                         |
| --------------------------------------------------- | ------------------------------------------------------------------ |
| `message_id` join makes queries slow on hot path    | New index `idx_memory_access_log_message`; fire-and-forget writes  |
| Disputed memory comes back due to high importance   | `dispute_count >= 3` auto-quarantines via `is_active = false`      |
| Reinforcement gaming (user spams ↑)                 | Saturate via `tanh()`; cap at `+0.15` boost regardless of count    |
| Pill clutter on every reply                         | Only render when count ≥ 1; collapsed by default; small typography |
| Backfilling assistant message_id race conditions    | UPDATE only where `message_id IS NULL`; idempotent                 |

---

## 7. Success criteria

- A user can tap any assistant reply and see, within 1 second, which
  memories shaped it.
- A user can reinforce or dispute a cited memory, and the next retrieval
  in the same conversation reflects the score change.
- The health card is visible somewhere users actually look.
- No measurable retrieval latency regression (p95 still ≤ 400 ms).
- GOD_PLAN.md Phase 5 is no longer "PENDING" in the status snapshot.
