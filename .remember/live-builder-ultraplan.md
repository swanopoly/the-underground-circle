# Chat Live Builder — Ultraplan

**Date drafted:** 2026-04-15

## Current state

| File | Responsibility |
|---|---|
| `src/components/chat/ChatBuildStudio.tsx` (373L) | Side pane with CODE / PREVIEW tabs. Iframe srcDoc sandbox for HTML. |
| `src/lib/codingWorkbench.ts` (72L) | FAKE live typing — hardcoded TSX skeleton + rotating phase labels + fake XP. |
| `src/components/chat/ChatArtifacts.tsx` (548L) | Per-message artifact renderer + canVerify hook. |
| `src/lib/huggingFaceChatCommands.ts → handleBuildPage` | Calls getSwanBotStructuredResponse; returns one artifact. |
| `ChatTab.tsx` | Mounts sidecar ≥ 1180px; tracks latestBuildArtifact; persists per thread. Draggable splitter. |
| Artifact kinds | webpage / code / text / link / file / diff / ... — only webpage previews. |
| Iframe sandbox | allow-scripts allow-same-origin. Static HTML only. |

## Top weaknesses
1. Fake typing animation — hardcoded template regardless of prompt
2. No real streaming — full await before render
3. Single-file only
4. Read-only
5. Static-HTML preview only (no React)
6. No revisions / history
7. No error / console surface
8. No device or theme preview
9. No deploy off-ramp
10. No constraints / brand pack
11. No collaborative state
12. codingWorkbench ≠ real lifecycle

## Benchmark — what the best live builders ship
- v0: multi-file stacks, pin-a-block, Tailwind-first
- bolt.new: in-browser Node via WebContainers
- Lovable: click-to-edit targets
- Replit Agent: long-running builds + real deploy
- Claude Artifacts: inline React via sandboxed iframe
- Cursor Composer: multi-file diffs, accept/reject

Common primitives we're missing: real streaming, multi-file, runtime, pin+iterate, deploy, diff revisions, click-to-edit.

## Target architecture (layers)
1. Storage — `build_projects` / `build_project_files` / `build_revisions`
2. Project model — multi-file tree, streaming handler, scoped diffs
3. Runtime — HTML + React via esbuild-wasm, device frames, error overlay, console
4. Edit & iterate — Monaco editor, lock files, click-to-edit, revision history, diff
5. Deploy / integrate — WP / GitHub / Netlify / Room / Share link

## Phases

### Phase 1 — Real streaming (1–2d)
- swanbot-ai + handleBuildPage → SSE/chunked
- ChatBuildStudio subscribes; appends tokens
- Kill fake-lines in codingWorkbench.ts
- Phases driven by real events (planning → writing <file> → verifying → done)

### Phase 2 — Multi-file project model (2–3d)
Types:
```ts
BuildProject { id, thread_id, title, entry_file, files, stack, revision_id }
BuildFile { path, content, language, locked, agent_can_edit }
```
- New tables + file tree UI
- Model writes become per-file `{ tool: 'write_file', path, content }`

### Phase 3 — React runtime (2–3d)
- esbuild-wasm lazy-loaded when previewing non-HTML
- Preinstalled kit (React 19 + Tailwind CDN + classnames)
- postMessage hot-reload channel

### Phase 4 — Error / inspect surface (1d)
- Console panel via postMessage
- Runtime error overlay with "Fix this error" CTA
- Network panel, HTML validator

### Phase 5 — Edit & iterate (3–4d)
- Monaco editor
- File locks (agent told "don't modify X")
- Click-to-edit in preview
- Revision history strip + thumbnails
- Diff view for agent edits (accept/reject per hunk)

### Phase 6 — Deploy / integrate (2d)
Toolbar buttons wired to:
- WP → scheduleAction kind wp_post
- GitHub → push to branch
- Netlify → new connector
- Pin to Room → existing room_files
- Share link → signed Storage URL

### Phase 7 — Brand pack (1d)
Per-circle brand (colors/fonts/logo/voice) auto-prepended to `/build-page` prompts. Toggle default / brand / custom.

### Phase 8 — Collaborative (3+d, optional)
Realtime channel on build_projects, per-user cursor, user-level file locking.

## Top 10 highest-impact improvements (if only one week)

1. Real token streaming
2. Copy / Download button in CODE header
3. Error overlay in preview
4. Device frame switcher (mobile/tablet/desktop)
5. Monaco editor for CODE tab
6. Stream → file-by-file writes
7. Publish-to-WordPress button in toolbar
8. Revision history (even last 5)
9. Regenerate-with-tweaks chip row (`[Make it darker]` etc.)
10. Click-to-edit in preview

## Integration with session's shipped primitives

- **Threads** → `build_projects.thread_id` ties builder state to chat thread
- **scheduled_actions** → Publish buttons queue a wp_post/social_post
- **Skills** (plan) → Builder is runtime for `web-research → blog-writer → wp-publisher` chain
- **Computer Use toggle** → "Save to ~/site/" via execBridgeCommand
- **Session sidebar** → private/circle threads naturally segregate builder state
- **Model picker** → GLM-5 / MiniMax / Claude drive the build
- **hf-proxy** → image generation for features/hero blocks

## Week-1 recommended slice

1. Real streaming (replace codingWorkbench.ts)
2. Copy + Download in CODE header
3. Error overlay in preview
4. Device frame switcher
5. Publish-to-WordPress via scheduled_actions

Delivers: visibly-streaming builder, copy-out, breakage visibility, responsive preview, one-click publish.

## Week-2 slice

6. Multi-file model + tree
7. Monaco editor
8. Revision history
9. Lock-files + click-to-edit
10. Brand pack prepend

## Tradeoffs

- esbuild-wasm ~3MB — lazy-load only on preview of non-HTML
- iframe allow-same-origin: scope sandbox per-owner if we ever embed UGC cross-user
- Monaco mobile-unfriendly on iOS Safari — keep mono-text read-only fallback
- Cap revisions at 20 per project, auto-prune
- Click-to-edit precision: always preview the highlighted element before submitting
