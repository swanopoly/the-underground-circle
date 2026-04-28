# Memory Wiki — Design

> **Goal:** Build an Obsidian-style browseable surface on top of UC's
> structured memory store. Markdown is the *interface*, the structured
> DB is the *substrate* — Mercury's hybrid principle, made literal.
>
> Status: planning · Date: 2026-04-28 · Owner: Swan

---

## 1. Why this, why now

UC's memory layer is structured (vector + RLS + soul-keyed) for good
reasons — it's an agent substrate, not a notebook. But that means
users currently see memory only as a flat list inside `AgentMemoryPanel`.
There is no "wander around and improve the knowledge base" surface,
which is the part of Karpathy's pattern that genuinely resonates with
humans.

`.agent-memory/context.md` is already auto-generated for CLI agents —
proof that we can render the structured store as Markdown without
losing fidelity. This spec extends that to a first-class in-app surface.

**This is the lowest-priority of the three plans** because it's net-new
surface area, not a closure of an existing gap. It should ship after
A and after B, when the substance and the marketing both stand up.

---

## 2. Current state

| Capability                                          | State          |
| --------------------------------------------------- | -------------- |
| Flat list memory panel                              | Shipped (`AgentMemoryPanel.tsx`) |
| `.agent-memory/context.md` exported for CLI agents  | Shipped (`scripts/sync-memories.js`) |
| `SoulMemoryScreen` exists                           | Shipped (`src/screens/wiki/SoulMemoryScreen.tsx`) |
| Browseable / cross-linked view                      | **Missing**    |
| Inline Markdown editing of memory content           | **Missing**    |
| Per-memory "see related" via embedding similarity   | **Missing**    |
| Public / private wiki views                         | **Missing**    |

The `wiki/` folder name suggests this direction was once started.
Audit this on Phase 0.

---

## 3. Design

### 3.1 Surface

`/circle/:id/wiki` — top-level circle tab, alongside Feed / Office / etc.
Lives in `src/screens/circles/tabs/WikiTab.tsx`.

**Layout (desktop):**
```
┌────────────┬───────────────────────────────────────┬────────────┐
│ SOULS      │  # The Q1 migration incident          │ RELATED    │
│            │                                       │            │
│ ▸ Architect│  We tried a NOT NULL backfill on the  │ ◆ Lock     │
│   42 mems  │  user_sessions table during peak…     │   timing…  │
│ ▸ Reviewer │                                       │ ◆ 3am UTC  │
│   17 mems  │  > Originally captured 2026-02-14     │   policy   │
│ ▸ Debugger │  > Reinforced 4×, last 2026-04-12     │            │
│   31 mems  │                                       │ EDIT      │
│ ▸ User     │  ## What we learned                   │ PIN       │
│   12 mems  │  - Always run backfill in chunks…     │ FORGET    │
│            │  - Locks need explicit release…       │            │
│ KINDS      │                                       │            │
│ ◆ Decision │  Edit ✎    Pin ★    Forget ✕         │            │
│ ◆ Policy   │                                       │            │
│ …          │                                       │            │
└────────────┴───────────────────────────────────────┴────────────┘
```

**Layout (mobile):** single column, soul/kind selector collapses into
a top sheet.

### 3.2 Components

**`WikiTab`** — top-level container. Three-pane on desktop, stacked on mobile.

**`MemoryNavTree`** (left) — soul + kind groupings with counts. Tappable
nodes filter the center pane.

**`MemoryDocView`** (center) — renders one memory as Markdown. Source =
`memory_entries.content` rendered with a small subset of MD (paragraphs,
lists, code, quotes). Editing toggles to a textarea.

**`MemoryRelatedPane`** (right) — top 5 semantically nearest memories
(via existing pgvector cosine), tappable to navigate. Same mechanism as
`retrieveForTurn` but applied to a memory's own embedding.

**`MemoryEditor`** — inline Markdown editor with version history.
Each save increments `version` and writes prior body to a new
`memory_versions` table.

### 3.3 Schema deltas

```sql
-- Migration: 20260428_memory_wiki.sql

-- Version history so edits don't destroy prior knowledge
create table memory_versions (
  id uuid primary key default gen_random_uuid(),
  memory_id uuid not null references memory_entries(id) on delete cascade,
  body text not null,
  edited_by uuid references auth.users(id),
  edited_at timestamptz default now(),
  edit_reason text
);
create index on memory_versions(memory_id, edited_at desc);

-- Optional: explicit cross-links (above and beyond embedding similarity)
create table memory_links (
  source_id uuid not null references memory_entries(id) on delete cascade,
  target_id uuid not null references memory_entries(id) on delete cascade,
  link_kind text not null check (link_kind in ('relates','contradicts','supersedes','example_of')),
  created_by uuid references auth.users(id),
  created_at timestamptz default now(),
  primary key (source_id, target_id, link_kind)
);
create index on memory_links(target_id, link_kind);
```

### 3.4 "Related" computation

For an open memory M:
1. Use `M.embedding` if present, else `embedAndStoreMemory(M.id)` synchronously.
2. Query: `select id, title, importance from memory_entries where circle_id = M.circle_id and id != M.id and embedding is not null order by embedding <=> M.embedding limit 5`.
3. Apply RLS automatically via the standard `user_can_see_memory` policy.

Cache result for 60 s in component state — no point re-querying every keystroke.

### 3.5 Markdown export

A "Download as Markdown" button generates a single `.md` file per soul
that mirrors `.agent-memory/context.md` but per-soul. Reuses the existing
sync script's renderer.

Optional Phase 4: a "Sync to Obsidian vault" path for power users who
want the Karpathy workflow on top of UC's substrate.

### 3.6 Non-goals

- Public-facing wiki (anyone can read). RLS still enforces circle membership.
- WYSIWYG editor — Markdown source only, with preview toggle.
- Bidirectional [[wikilinks]] in v1 — autolinks come in v2 if needed.
- Replacing `AgentMemoryPanel` — keep both. The panel is the inbox; the
  wiki is the library.

---

## 4. Phased rollout

### Phase 0 — Audit existing wiki scaffolding (½ day)
- Read `src/screens/wiki/SoulMemoryScreen.tsx`. Decide: extend or rewrite.
- Verify `memory_versions` and `memory_links` don't already exist under
  another name.
- **Exit:** decision recorded in this spec; existing code understood.

### Phase 1 — Read-only wiki (1 day)
- `WikiTab` + `MemoryNavTree` + `MemoryDocView` + `MemoryRelatedPane`.
- No editing yet. Just browse.
- Wire route `/circle/:id/wiki`.
- **Exit:** user can navigate the memory store like a knowledge base.

### Phase 2 — Inline editing + version history (1 day)
- `memory_versions` migration.
- `MemoryEditor` component.
- Reinforcement / dispute / forget already exist — keep them in this view.
- **Exit:** user can rewrite a memory; old version preserved.

### Phase 3 — Cross-links + similarity (1 day)
- `memory_links` migration + UI to add explicit links.
- Related-pane already shows similarity-based links from Phase 1.
- **Exit:** user can chain "this memory contradicts X" / "this is an
  example of Y" relationships.

### Phase 4 — Markdown export + Obsidian sync (½ day, optional)
- Per-soul `.md` download.
- Optional: directory sync mirroring `.agent-memory/context.md`.
- **Exit:** Karpathy-pattern users can use UC's substrate inside Obsidian.

Total: **~3.5 days for Phases 0–3; +½ day for Phase 4.**

---

## 5. File-level delta map

| File                                                | Change                            | Phase |
| --------------------------------------------------- | --------------------------------- | ----- |
| `supabase/migrations/20260428_memory_wiki.sql`      | NEW — versions + links            | 2/3   |
| `src/screens/circles/tabs/WikiTab.tsx`              | NEW — top-level wiki container    | 1     |
| `src/components/wiki/MemoryNavTree.tsx`             | NEW                               | 1     |
| `src/components/wiki/MemoryDocView.tsx`             | NEW                               | 1     |
| `src/components/wiki/MemoryRelatedPane.tsx`         | NEW                               | 1     |
| `src/components/wiki/MemoryEditor.tsx`              | NEW                               | 2     |
| `src/lib/memoryWiki.ts`                             | NEW — fetch/edit/link APIs        | 1+2+3 |
| `src/lib/memoryRelated.ts`                          | NEW — similarity query            | 1     |
| `App.tsx` / circle routing                          | wiki route                        | 1     |
| `scripts/sync-memories.js`                          | extend per-soul export            | 4     |

---

## 6. Risks

| Risk                                                | Mitigation                                                       |
| --------------------------------------------------- | ---------------------------------------------------------------- |
| Spread thin — yet another tab to maintain          | Only build after A and B prove the substance + framing           |
| Editing destroys prior knowledge                    | `memory_versions` writes pre-edit body; restore button           |
| Performance on large memory counts                  | Virtualized list in NavTree; paginate kind/soul groups           |
| Embedding similarity returns stale neighbors        | Refresh on memory edit; invalidate cache after consolidation     |
| Free-text editing introduces contradictions silently| Run `detectContradictions` after edit; surface result inline     |

---

## 7. Dependencies

- Plan A (Inspect & Control) should ship first — citation pill exposes
  what's in the store, wiki is where you go to fix things.
- Plan B (Positioning) should ship second — the wiki is good marketing
  material; the deep-dive page can screenshot it.

---

## 8. Success criteria

- Users browse memory like Obsidian, not like a database table.
- Editing a memory preserves the prior version.
- "Related" pane shows semantically meaningful neighbors, not random.
- The wiki view replaces 0 features and adds 1 — it's purely additive.
- A power user can export their soul's memory to a Markdown vault and
  read it without UC running.
