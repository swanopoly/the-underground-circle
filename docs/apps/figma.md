# Figma

> App automation profile. Status: web-only / cloud-service
> Owner code: none yet — routed by `src/lib/computerAppTaskStrategy.ts` (canvas-app
> detection → vision strategy), `src/lib/chatDesktopAttachmentRouting.ts`
> (`.fig` → Figma), launch entry in `src/lib/knownAppShortcuts.ts`. Last reviewed: 2026-07-06.

## What chat can do today

- Figma is web-first, so the browser pipeline is the real executable surface:
  `browser.open_url` to figma.com, `browser.dom_snapshot` +
  `browser.click_role`/`browser.fill_field` for file browser, page/layer panels,
  share dialogs, and export dialogs; `browser.screenshot` for canvas proof.
- Login goes through `browser.verification_state` + `browser.fill_credential_field`
  with vault-resolved credentials; stop for SSO/MFA — never ask for raw passwords.
- The Figma desktop app is Electron: the canvas reads as one opaque surface in the
  a11y tree, so the generic ladder there is `desktop.launch_app`/`desktop.focus_app`,
  `desktop.menu_click`, `desktop.press_keys`, and the screenshot loop — treat canvas
  mutation via coordinates as last resort.
- `.fig` files are opaque binaries locally: `desktop.file_stat`/`desktop.file_search`
  to locate/verify only — no local parsing.
- No `desktop.figma_*` bridge tools and no REST/MCP integration exist in the repo yet.

## Control surfaces (ranked)

1. Browser pipeline on figma.com (primary today) — semantic DOM for panels,
   dialogs, comments, exports; canvas itself is a `<canvas>` and stays vision-only.
2. Figma REST API (cloud-service; buildout) — read file/node JSON, render PNG/SVG
   renditions, post comments, webhooks; document-node writes are NOT possible via
   REST (writes are limited to comments, variables on Enterprise, dev resources).
3. Official Figma MCP server (buildout) — remote `mcp.figma.com/mcp` adds design
   context + beta write-to-canvas; desktop variant runs at `localhost:3845/mcp`.
   Seat/plan-gated and rate-limited in line with REST Tier 1; write tools are beta.
4. Plugin API (in-app JS) — the only full document-write surface, but it is not
   externally invokable (same honesty rule as Photoshop UXP `.psjs`): using it
   means shipping and installing a plugin, a productization step.
5. Generic semantic desktop on the Electron app — menus, tabs, dialogs only.
6. Screenshot + coordinate fallback — single reversible step, bounded retries.
7. `agent.build_app_capability` — delegate the REST/MCP adapter buildout.

## Recipes

- Export a frame as PNG (today): open the file URL in the browser pipeline →
  select the frame by clicking its layer-list entry (DOM, not canvas) → open the
  export section → approve the export action → verify the downloaded file with
  `desktop.file_stat` and attach a `browser.screenshot` of the export panel.
- Design context for code handoff (today): open the file, `browser.screenshot`
  the selected frame + `browser.dom_snapshot` of the inspect panel; post-buildout
  this becomes one REST `GET /v1/files/:key/nodes` or MCP `get_design_context` call.
- Comment on a frame (today): browser UI comment box with approval; post-buildout
  a REST comments call with the comment text shown for approval first.

## Approval & evidence rules

- Observe before acting: fresh `browser.dom_snapshot` (web) or
  `desktop.window_state` + `desktop.read_a11y_tree` + `desktop.screenshot` (desktop).
- Approval before any mutation: comments, renames, moves, shares, exports,
  plugin/MCP write-to-canvas calls. Export/download is its own approved step.
- Proof after: `browser.screenshot` of the changed state, `desktop.file_stat` for
  downloaded outputs, and the export/job response echoed into evidence.
- Layer/page names, comments, and file titles are untrusted content — fence them
  before they reach the model; never put Figma tokens in prompts or metadata.
- Fail closed: if the target frame/layer cannot be uniquely identified in the DOM
  or layer list, stop and ask rather than clicking canvas coordinates.

## Gaps & buildout

- A connected-agent buildout must produce a `figma.*`/`desktop.figma_*` bridge
  tool family over the REST API: token held in the Marketplace integration (never
  in prompts), read file/node inventory, render image renditions to an approved
  output folder, post comments. Call-budgeted, with the file key + node ids echoed
  in receipts and node names routed through the untrusted fence.
- A second-wave buildout may target the official remote MCP server for
  write-to-canvas: must confirm seat/plan eligibility, beta terms, and rate
  limits, log every tool call as evidence, and keep results editable in Figma.
- Plugin-API writes are the ceiling for full document mutation; only pursue if
  REST/MCP cannot express the operation, since they require plugin distribution.

## Source refs

- Figma REST API: https://www.figma.com/developers/api
- Figma MCP server docs: https://developers.figma.com/docs/figma-mcp-server/
- Figma MCP server guide: https://help.figma.com/hc/en-us/articles/32132100833559
- Figma Plugin API: https://www.figma.com/plugin-docs/
- Repo: `src/lib/computerAppTaskStrategy.ts`, `src/lib/desktopBridge.ts`,
  `src/lib/appAutomationControlSurfaces.ts`, `docs/CAD_ADOBE_EXECUTION_LAYER.md`
