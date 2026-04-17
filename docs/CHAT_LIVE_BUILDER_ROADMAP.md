# Chat Live Builder — Roadmap

> Permanent reference for the side-pane "Studio" that renders code + live
> preview next to chat when a build task is in flight.
> Last updated: 2026-04-15

## Surface-level summary

When a user triggers `/build-page` or a coding-generation prompt, a sidecar
panel opens to the right of chat (web ≥ 1180px). It has **CODE** and
**PREVIEW** tabs. PREVIEW only activates for `kind: 'webpage'` artifacts;
the code is sandboxed into an iframe with `allow-scripts allow-same-origin`.
Today everything is read-only, single-file, and the "typing animation"
while awaiting the model is a hardcoded TSX template — not real streaming.

## Current files (audit)

| File | Responsibility |
|---|---|
| `src/components/chat/ChatBuildStudio.tsx` | The side pane component (CODE / PREVIEW tabs, iframe srcDoc). |
| `src/lib/codingWorkbench.ts` | Fake live typing — hardcoded TSX skeleton, rotating phase labels (`BOOTING CONTEXT` → `VERIFYING BUILD`), fake XP metric. |
| `src/components/chat/ChatArtifacts.tsx` | Per-message artifact renderer + verify hook. |
| `src/lib/huggingFaceChatCommands.ts` → `handleBuildPage` | Wraps `getSwanBotStructuredResponse('/build-page …')`. |
| `src/screens/circles/tabs/ChatTab.tsx` | Mounts the sidecar, tracks `latestBuildArtifact`, persists per thread via `saveLastThreadBuildArtifact`, handles the draggable splitter. |

Artifact kinds today: `text | link | file | diff | summary | image | translation | classification | vision | audio | code | webpage`. Only `webpage` previews.

## Top weaknesses

1. Fake typing animation — always the same TSX skeleton
2. No real token streaming — full await before render
3. Single-file artifacts only
4. Read-only — user cannot edit generated code
5. Static HTML preview only (no React runtime)
6. No revision history
7. No error / console surface when iframe fails
8. No device or theme preview
9. No deploy off-ramp (have to copy-paste)
10. No constraints / brand pack
11. No collaborative state (multi-user)
12. `codingWorkbench.ts` fake lifecycle not tied to real lifecycle

## Benchmark — what the best live builders ship

| Product | Primitive we're missing |
|---|---|
| Vercel v0 | Multi-file stacks, pin-a-block, Tailwind-first, export-to-Next |
| bolt.new | Node-in-browser via WebContainers |
| Lovable | Click-to-edit targets |
| Replit Agent | Long-running builds + real deploy |
| Claude Artifacts | Inline React via sandboxed iframe |
| Cursor Composer | Multi-file diffs, accept/reject |

## Target architecture

Five stacked layers, each shippable alone:

1. **Storage** — `build_projects`, `build_project_files`, `build_revisions`
2. **Project model** — typed multi-file tree, streaming handler, scoped diffs
3. **Runtime** — static HTML + React via esbuild-wasm; device frames; error overlay; console
4. **Edit & iterate** — Monaco editor, file locks, click-to-edit, revision history, diff view
5. **Deploy / integrate** — WP / GitHub / Netlify / Room / signed share link

## Phase-by-phase

### Phase 1 — Real streaming (1–2 days)

- swanbot-ai + `handleBuildPage` switch to SSE or chunked response
- `ChatBuildStudio` subscribes; appends tokens as they arrive
- Kill the fake-lines path in `codingWorkbench.ts`
- Phase labels driven by real events: `planning → writing <file> → verifying → done`
- Blinking cursor at end of buffer

### Phase 2 — Multi-file project model (2–3 days)

```ts
interface BuildProject {
  id: string;
  thread_id: string;
  title: string;
  entry_file: string;
  files: Record<string, BuildFile>;
  stack: 'vanilla' | 'react' | 'next' | 'tailwind' | 'custom';
  revision_id: string;
}

interface BuildFile {
  path: string;
  content: string;
  language: string;
  locked: boolean;
  agent_can_edit: boolean;
}
```

- New tables: `build_projects`, `build_project_files`, `build_revisions`
- Studio gets a **left file tree** above the CODE / PREVIEW tabs
- Model tool_actions become per-file writes: `{ tool: 'write_file', path, content }`
- UI updates file-by-file as tokens stream in

### Phase 3 — React runtime in the preview iframe (2–3 days)

- Bundle **esbuild-wasm** — lazy-loaded only when preview is opened on a non-HTML project
- Preinstall runtime kit: React 19 + react-dom + classnames + Tailwind CDN
- Iframe becomes a tiny SPA host; hot-reload channel via postMessage

Tradeoff: ~3MB WASM download on first non-HTML preview.

### Phase 4 — Error / inspect surface (1 day)

- **Console panel** forwards iframe `console.log/warn/error` via postMessage into a collapsible drawer
- **Runtime error overlay** — red banner with stack trace + "Fix this error" button that feeds the error back to the agent
- **Network panel** (CORS-scoped)
- **HTML validator** — client-side lint for sandbox issues

### Phase 5 — Edit & iterate (3–4 days)

- Monaco editor on web; syntax-highlighted per language; user edits persist across turns
- **File locks** — lock icon; agent system prompt includes "do not modify locked files"
- **Click-to-edit in preview** — hover → outline; click element → prompt prefilled with its attributes
- Revision history strip (horizontal, with thumbnails) — click to revert
- Diff view when the agent modifies existing files; accept-all / reject-all / per-hunk

### Phase 6 — Deploy & integrate (2 days)

Toolbar buttons wired to existing primitives:

- **Publish to WordPress** → `scheduleAction({ kind: 'wp_post', payload })` (already works end-to-end)
- **Save to GitHub** → existing `github.ts` push to branch
- **Deploy to Netlify** → new connector (minimal scope)
- **Pin to Room** → existing `room_files` table
- **Share preview link** → signed Supabase Storage URL

### Phase 7 — Brand pack (1 day)

Per-circle brand pack (colors / fonts / logo / voice). Auto-prepended to
`/build-page` prompts. Toggle: default / brand / custom constraints.

### Phase 8 — Collaborative builder (3+ days, optional)

- Realtime channel on `build_projects`
- Per-user cursor in the editor (start simple: no CRDT, last-write-wins with cursor broadcast)
- User-level file locking: "Alice is editing styles.css"

## Top 10 immediate improvements (ranked by impact ÷ effort)

1. Real token streaming
2. Copy / Download button in CODE header
3. Error overlay in the preview
4. Device frame switcher (mobile / tablet / desktop)
5. Monaco editor for the CODE tab
6. Stream → file-by-file writes
7. Publish-to-WordPress button in the toolbar
8. Revision history (even just last 5)
9. "Regenerate with tweaks" chip row: `[Make it darker] [Add a contact form] [Mobile-first]`
10. Click-to-edit in preview

## Integration points with primitives already built

- **Threads** → `build_projects.thread_id` ties builder state to the active chat thread
- **scheduled_actions** → Publish / Schedule buttons queue a `wp_post` / `bluesky_post` etc; cron executes; Outbox shows pending
- **Skills library** (roadmap) → Builder is the runtime for the `web-research → blog-writer → wp-publisher` chain
- **Computer Use toggle** → "Save to ~/mysite/" via `execBridgeCommand`
- **Session sidebar** → private vs circle threads naturally segregate builder state
- **Model picker** (GLM-5 / MiniMax / Claude) drives the build via the current routing
- **hf-proxy** → image generation for hero / features

## Recommended Week 1 slice

1. Real streaming (replace `codingWorkbench.ts`'s fake loop)
2. Copy + Download buttons in CODE header
3. Error overlay in preview
4. Device frame switcher
5. Publish-to-WordPress via `scheduled_actions`

Delivers: visibly-streaming code, copy-out, breakage visibility, responsive
preview, one-click publishing to a real website.

## Recommended Week 2 slice

6. Multi-file model + file tree
7. Monaco editor
8. Revision history
9. Lock-files + click-to-edit
10. Per-circle brand pack prepend

## Tradeoffs to be aware of

- esbuild-wasm is ~3MB — never include in initial bundle; lazy-load on first non-HTML preview
- `allow-same-origin` scope: if we ever embed cross-user UGC code, scope sandbox per-owner
- Monaco is mobile-unfriendly on iOS Safari — keep the read-only mono-text view as fallback
- Revision history storage: cap at 20 revisions per project, auto-prune
- Click-to-edit precision: always show the highlighted element before submitting the prompt; models mis-target small elements
