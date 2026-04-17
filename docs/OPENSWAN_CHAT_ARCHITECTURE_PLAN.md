# OpenSwan / Chat Architecture Plan

> Companion to `AGENT_MEMORY_GOD_PLAN.md`. Memory is the substrate; this
> plan covers everything else in the OpenSwan service surface — how users
> invoke it, how it composes SOULs + skills + memory into a prompt, how
> it streams, what it can do mid-turn, and how users see and trust its
> work. Last updated 2026-04-15.

---

## 0. North star

One service. The user talks to OpenSwan; the service figures out who's
asking, what SOUL they need, what the team has learned together, what
files they've given it, and what tools it can call to finish the job.
Every turn is an opportunity to make the next turn smarter.

Three properties we want the user to *feel*:

1. **One address, many modes.** "OpenSwan" is a single service — the
   mode (Build/Review/Debug/Arch) just changes what work it does.
2. **It sees what I see.** Files, links, screenshots I attach become
   first-class context, not a second chat window.
3. **It grows with us.** Each team's OpenSwan is different because it
   has different memories, different SOUL wisdom, different tools.

---

## 1. Current state (after this session)

**Already shipped** — don't re-plan these:

- Threaded multi-session chat (private / shared / circle) with invite +
  auto-promote trigger (`circle_chat_threads`).
- OpenSwan service menu — single collapsed dropdown `OPENSWAN · BUILD · AUTO ▾`
  covering 4 profiles × 3 delegation modes, same controls on every thread.
- Memory god plan Phases 0–4 live: soul routing, pgvector embeddings,
  turn-time semantic retrieval, weekly SOUL wisdom distillation, daily
  maintenance. Phase 5 (observability UI) still queued.
- Scheduled actions: 10 kinds all have real executors (`wp_post`,
  `tweet`, `linkedin_post`, `gmail_send`, `gmail_draft`, `outlook_send`,
  `slack_post`, `bluesky_post`, `webhook`, `reminder`).
- Builder V2: streaming tokens, history, device frames, share link,
  WP queue, GitHub commit, Netlify one-click deploy, templates, brand
  pack, image library, a11y audit, point-edit, fullscreen, console.
- Providers via `llm-proxy`: OpenAI, Anthropic, Groq, OpenRouter,
  HuggingFace, GitHub Models, Ollama, z.ai GLM-5, MiniMax,
  openai-embed. Timeouts + platform-secret fallbacks per provider.

**The remaining seams** — this plan's scope:

| Gap                                                 | Where it bites                                       |
| --------------------------------------------------- | ---------------------------------------------------- |
| Chat attachments (files beyond builder images)      | Users can't drop a PDF / CSV / screenshot into chat  |
| No SSE streaming into the chat bubble               | Every turn feels batch — big answers take 5–10s     |
| No tool-use mid-turn                                | Model can't fetch a URL, read a file, run code       |
| SessionProfile → SOUL mapping is informal           | The menu picks a SOUL but the plumbing doesn't know  |
| Multi-model routing is per-user, not per-SOUL       | "Architect" could default to Opus, "Debug" to Haiku  |
| Skills layer is a concept in the roadmap, not code  | No way to bolt capabilities onto a SOUL              |
| Per-run cost / latency surface is backend-only      | Users can't see "this reply cost $0.03 in 1.8s"      |
| Mid-turn memory annotations (`/remember this`)      | Memory only writes back at turn end                  |

---

## 2. The six pillars

Every design decision that follows maps to exactly one.

```
┌──────────────┐  ┌──────────────┐  ┌──────────────┐
│ 1. SURFACE   │  │ 2. COMPOSER  │  │ 3. RUNTIME   │
│ how users    │→ │ how the      │→ │ how a turn   │
│ invoke       │  │ prompt is    │  │ actually     │
│ OpenSwan     │  │ built        │  │ executes     │
└──────────────┘  └──────────────┘  └──────────────┘
                                          │
┌──────────────┐  ┌──────────────┐  ┌──────────────┐
│ 6. FEEDBACK  │←─│ 5. TRUST     │←─│ 4. CONTEXT   │
│ write-back   │  │ observability│  │ files + mem  │
│ into memory  │  │ + citations  │  │ + soul       │
└──────────────┘  └──────────────┘  └──────────────┘
```

- **Surface** — the composer, the service menu, the invocation modes.
- **Composer** — who owns which block of the system prompt (SOUL static
  prompt → Block A; SOUL wisdom → Block B; turn retrieval → Block C;
  attachments → Block D; skills contract → Block E).
- **Runtime** — streaming, tool-use, per-SOUL model routing, timeouts.
- **Context** — attachments (files, images, URLs), memory, SOUL wisdom.
- **Trust** — cost/latency surfacing, "why did you say this," memory
  citation.
- **Feedback** — extraction loop, user-driven pin/flag/forget,
  procedural-memory capture from successful workflows.

---

## 3. Future architecture

### 3.1 Surface

- `sessionProfile` becomes a first-class enum mapped to SOULs in one
  file: `src/lib/serviceProfileSouls.ts` — `{Build:'sr-engineer', Review:'code-reviewer', Debug:'debugger', Arch:'architect'}`.
  Everywhere that cares (system-prompt builder, model router, memory
  retrieval) imports from one source.
- The service dropdown remains the single truth for mode selection.
  Circle chat + private chat + room chat all share it.
- A new **+ Attach** button sits to the left of the send box. Accepts
  any mime type, drag-and-drop, multi-file. Staged chips above input.

### 3.2 Composer

The system-prompt builder in `swanbot.ts` already composes Block A
(base) + startup bundle + identity + mission + Block B (SOUL wisdom)
+ Block C (turn retrieval). Add two:

- **Block D — Attachment context.** Per-attachment summaries + signed
  URLs. Text files inlined up to a cap, images sent as vision content
  blocks when the target model supports it, binaries referenced by
  filename + URL.
- **Block E — Skills contract.** When skills are enabled for a SOUL
  (see §3.7), inject the skill manifest + invocation protocol so the
  model knows it has `run_code`, `fetch_url`, `search_memories` etc.
  available.

All blocks share one hard budget per model (12k chars for Haiku, 20k
for Sonnet, 50k for Opus 1M). Blocks drop in priority order when the
budget is exceeded: D (attachments) > A (base) > B (wisdom) > C
(retrieval) > E (skills) > extras.

### 3.3 Runtime

- **SSE streaming everywhere.** `build-stream` already proves the
  pattern. Generalize: `chat-stream` edge fn that forwards Anthropic /
  OpenAI SSE deltas directly to the client. Bubble updates
  token-by-token instead of appearing on completion.
- **Tool-use scaffold.** An OpenSwan-specific tool dispatcher:
  `run_code`, `fetch_url`, `search_memories` (semantic), `read_file`
  (uploaded attachment), `list_circle_members`, `schedule_action`.
  Each tool is a typed TS handler registered in a manifest. The dispatcher
  logs every invocation + result to `agent_runs` children.
- **Per-SOUL model defaults.** `resolveModelForSoul(soulKey, userPref)`:
  Architect → Opus; Build → Sonnet; Debug → Sonnet w/ extended thinking;
  Review → Haiku first, escalate to Sonnet on diff >500 lines. User's
  explicit model pick always wins.
- **Adaptive timeouts.** 30s for fast tools, 60s for code, 120s for
  extended thinking. All via `AbortController` like the OpenSwan
  polling fix already shipped.

### 3.4 Context (attachments)

- DB: `message_attachments` table (id, message_id, circle_id,
  thread_id, user_id, storage_path, mime_type, original_name,
  size_bytes, ocr_text, extract_text, created_at). RLS via thread
  membership.
- Storage: Supabase `chat-attachments` bucket, path pattern
  `{circle_id}/{thread_id}/{user_id}/{uuid}-{filename}`. Signed URLs on
  read. 50 MB per file, 10 files per message default caps.
- Upload: ChatComposer gets `+ Attach`, drag-drop overlay, paste from
  clipboard (for screenshots). Optimistic staged chips with thumbnails
  for images.
- Extraction pipeline: for images, call a vision model (Anthropic or
  GPT-4 vision) to get alt-text + OCR; for text files, inline up to
  10k chars; for PDFs, page-by-page text; for CSVs, schema + first 20
  rows. All stored in `ocr_text` / `extract_text` for retrieval.
- Attachments become first-class **memory targets** too — a user can
  attach a design doc and explicitly "pin this as the canonical
  design," promoting extracted content to circle-shared memory.

### 3.5 Trust

- **"Used N memories" pill** under every assistant message, queried
  from `memory_access_log` by the run id.
- **Tap to expand** → list of cited memories with similarity score,
  role (primary/shared), importance, timestamp. Each row has a "⚠ not
  helpful" button that decays the memory's importance.
- **Per-run cost + latency** drawer: input/output tokens by provider,
  cached vs fresh, total cost, wall clock. Already tracked in
  `user_ai_usage`; just needs the UI.
- **Pin / flag / edit** in AgentMemoryPanel (Phase M5 of the memory
  plan — same slice as this).
- **Rage-forget**: `/forget <query>` slash command OR a button that
  deactivates every memory matching a semantic+keyword match, writes
  a `memory_access_log` row with reason `manual_pin` and rationale for
  the undo audit trail.

### 3.6 Feedback loop

- **Mid-turn `/remember this`** — a slash command that snapshots the
  *previous* assistant message as a manual memory, routed via the
  Phase 0 Soul router. No waiting for auto-extraction.
- **Procedural memory on success.** When a `scheduled_action` runs to
  `status='succeeded'` or a builder artifact ships to
  `builder_publications`, call `saveProceduralMemory()` (already exists
  in `memoryConsolidation.ts`) with the steps and outcome.
- **Correction pattern detection.** If the user edits an assistant
  message with a preface like "actually…" or "you missed…", fire
  extraction on just the correction span so we learn explicitly from
  being wrong.

### 3.7 Skills (new concept beyond SOULs)

SOULs answer *who*. Skills answer *what they can do right now*.

- `skills` table: id, name, description, handler_ref, allowed_souls[],
  requires_tools[], cost_estimate.
- System-prompt Block E injects a skill manifest so the model knows it
  can call `critique_pr`, `benchmark_llms`, `dig_for_bug` etc.
- Skills are shippable as small packages — each one is a config +
  optional tool binding + optional system-prompt fragment.
- Circle admins enable/disable skills per SOUL; users invoke with
  `/skill critique_pr` or natural language the model interprets.

---

## 4. Phased rollout (estimated 9–12 build days total)

### Phase M5 — Memory observability UI  (1–2 d)
*Closes the memory god plan.*
- "Used N memories" pill on assistant bubbles.
- Memory citation drawer keyed to `memory_access_log`.
- Pin / flag / edit in AgentMemoryPanel.
- `/forget` slash command with semantic matcher.

**Exit:** a user can audit, pin, and delete any memory path end-to-end.

### Phase C1 — Chat attachments  (2–3 d)
**Do:**
- `message_attachments` migration + `chat-attachments` bucket + RLS.
- `src/lib/chatAttachments.ts` (upload / list / delete / signUrl /
  extractText).
- Composer UI: + Attach button, drag-drop, paste-to-upload, staged
  chip strip, remove-before-send.
- Rendering: inline thumbnails for images, file cards for others.
- Context injection: Block D in swanbot.ts; vision blocks for
  capable models.

**Exit:** user can drop any file (image, PDF, text, CSV, zip) into
chat and OpenSwan references it in the reply.

### Phase C2 — SSE streaming in chat  (2 d)
**Do:**
- New `chat-stream` edge fn forwarding Anthropic SSE deltas.
- Client consumer in `callGemini` → `callStreamed`; bubble updates
  token-by-token.
- Fallback to non-streaming when provider lacks SSE (GLM-5, some
  HuggingFace routes).

**Exit:** long responses visibly type in; cold-start perceived latency
drops from 5–10s to <500ms.

### Phase C3 — Service-profile → SOUL mapping + per-SOUL model routing  (1 d)
**Do:**
- Create `src/lib/serviceProfileSouls.ts` — single enum + map.
- `resolveModelForSoul(soulKey, userOverride)` in same file.
- Consume from `swanbot.ts`, `ChatTab.tsx`, the builder stream.

**Exit:** picking "Arch" in the dropdown routes to Opus; picking "Debug"
routes to Sonnet thinking-mode; user override still wins.

### Phase C4 — Tool-use scaffold  (2–3 d)
**Do:**
- Define `OpenSwanTool` interface + dispatcher.
- First three tools: `search_memories`, `fetch_url`, `read_attachment`.
- Anthropic tool-use binding via the Messages API.
- Persist tool calls + results to `agent_run_steps`.

**Exit:** Architect SOUL, asked "what did we decide about auth?", calls
`search_memories` and answers with citations from the memory store.

### Phase C5 — Skills layer  (2 d)
**Do:**
- `skills` table + `circle_soul_skills` join.
- Skill registry in `src/lib/skillRegistry.ts`.
- System-prompt Block E.
- First two skills: `critique_pr`, `summarize_thread`.

**Exit:** admin enables `critique_pr` for the `code-reviewer` SOUL;
user invokes with `/skill critique_pr <pr-url>` → full review.

### Phase C6 — Run-level cost + latency panel  (1 d)
**Do:**
- Query `user_ai_usage` by `run_id` for the assistant message.
- Drawer component showing tokens / cost / wall-clock / cache-hit %.
- Circle-wide weekly rollup on the Analytics tab.

**Exit:** user can see "this reply cost $0.04, used 3 tools, took
2.1s, cited 8 memories" in one tap.

---

## 5. Risks + mitigations

| Risk                                                | Mitigation                                                                 |
| --------------------------------------------------- | -------------------------------------------------------------------------- |
| Attachment upload blocks chat                       | Upload pipeline is async + optimistic; chat send waits only for metadata  |
| Vision extraction explodes cost                     | Cap per-image at 1 vision call, cache OCR in `message_attachments`        |
| Tool-use loops forever                              | Hard cap: 5 tool calls per turn, 2 recursive levels max                   |
| Streaming breaks when provider doesn't support SSE  | Graceful degrade to batch; detect by provider feature flag                |
| Per-SOUL Opus routing blows budget                  | Soft per-user daily cost ceiling; fall back to Sonnet when hit            |
| Skills conflict with SOUL prompts                   | Skills contribute only Block E; SOUL prompts remain authoritative          |
| Rage-forget deletes too broadly                     | Semantic+keyword match must overlap; soft-delete with 30d reversible undo |

---

## 6. Appendix — file-level delta map

| Phase | File                                                          | Change                                                    |
| ----- | ------------------------------------------------------------- | --------------------------------------------------------- |
| M5    | `src/screens/circles/tabs/office/AgentMemoryPanel.tsx`        | pin/flag/edit; citation drawer                            |
| M5    | `src/components/chat/MessageCitations.tsx` (NEW)              | "Used N memories" + expand                                |
| M5    | `src/lib/memoryActions.ts` (NEW)                              | `rageForget`, `pinMemory`, `decayImportance`              |
| C1    | `supabase/migrations/20260420_message_attachments.sql` (NEW)  | table + bucket policy                                     |
| C1    | `src/lib/chatAttachments.ts` (NEW)                            | upload/list/sign/extract                                  |
| C1    | `src/screens/circles/tabs/ChatTab.tsx`                        | + Attach button, drag-drop, staged strip                  |
| C1    | `supabase/functions/extract-attachment/index.ts` (NEW)        | vision OCR + text extraction edge fn                      |
| C1    | `src/lib/swanbot.ts`                                          | Block D injection                                         |
| C2    | `supabase/functions/chat-stream/index.ts` (NEW)               | SSE forwarder                                             |
| C2    | `src/lib/swanbotStream.ts` (NEW)                              | client SSE consumer                                       |
| C3    | `src/lib/serviceProfileSouls.ts` (NEW)                        | enum + model resolver                                     |
| C3    | `src/lib/swanbot.ts`                                          | use resolver for model pick                               |
| C4    | `src/lib/openswanTools/` (NEW dir)                            | tool definitions + dispatcher                             |
| C4    | `src/lib/swanbot.ts`                                          | tool-use loop with Anthropic Messages API                 |
| C5    | `supabase/migrations/20260421_skills.sql` (NEW)               | `skills`, `circle_soul_skills`                            |
| C5    | `src/lib/skillRegistry.ts` (NEW)                              | skill manifests + handlers                                |
| C5    | `src/lib/swanbot.ts`                                          | Block E injection                                         |
| C6    | `src/components/chat/RunCostDrawer.tsx` (NEW)                 | per-run tokens / cost / latency UI                        |
| C6    | `src/screens/circles/tabs/AnalyticsTab.tsx`                   | circle-wide weekly rollup                                 |

---

*End of plan.*
