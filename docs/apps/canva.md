# Canva

> App automation profile. Status: web-only / cloud-service
> Owner code: none yet — launch entry in `src/lib/knownAppShortcuts.ts`
> (`webAppQuality: 'full'`), canvas-app detection in
> `src/lib/computerAppTaskStrategy.ts`. Last reviewed: 2026-07-06.

## What chat can do today

- Canva is a full-quality web app, so the browser pipeline executes real work
  today: `browser.open_url` to canva.com, `browser.dom_snapshot` +
  `browser.click_role`/`browser.fill_field` for templates, text boxes, panels,
  share/download dialogs; `browser.upload_file` for asset uploads;
  `browser.screenshot` for canvas proof.
- Canva's editor UI is unusually semantic for a design tool (text elements are
  DOM-editable), so text edits, template selection, page management, and
  download/export flows are all reachable without coordinate clicks.
- Login: `browser.verification_state` + `browser.fill_credential_field` with
  vault-resolved credentials; stop for SSO/MFA/CAPTCHA.
- The Canva desktop app is an Electron wrapper — prefer the browser pipeline;
  the generic desktop ladder adds nothing there.
- No `canva.*`/`desktop.canva_*` bridge tools and no Connect API integration
  exist in the repo yet.

## Control surfaces (ranked)

1. Browser pipeline on canva.com (primary today) — semantic DOM covers most of
   the editor; deep canvas drawing stays vision-assisted.
2. Canva Connect APIs (cloud-service; buildout) — REST with OAuth: create
   designs, upload assets, async export jobs, folders; brand-template autofill
   is Enterprise-gated. The right lane for repeatable batch/production work.
3. Official Canva MCP server (buildout) — vendor agent surface over the same
   capabilities; must confirm plan eligibility and tool coverage per task.
4. Apps SDK (in-app) — Canva's in-editor extension surface; not externally
   invokable, a productization step only.
5. Screenshot + coordinate fallback on the canvas — single reversible step.
6. `agent.build_app_capability` — delegate the Connect API adapter buildout.

## Recipes

- Create from template + edit text (today): open canva.com → search/select the
  template (DOM) → approve the design creation → click each text element and
  replace copy via `browser.fill_field`-style DOM edits → `browser.screenshot`
  proof per page.
- Export/download a design (today): open the share/download dialog, choose
  format (PNG/PDF), approve the download, verify locally with
  `desktop.file_stat`; post-buildout this becomes a Connect export job with a
  polled job receipt.
- Bulk variants (post-buildout): brand-template autofill via Connect API with
  the field/data mapping approved first — mirrors the InDesign data-merge
  contract in `src/lib/designAppCreativeAi.ts`.

## Approval & evidence rules

- Observe before acting: fresh `browser.dom_snapshot` of the editor state and
  the exact element to be edited.
- Approval before any mutation: design creation, text/asset edits, sharing,
  publishing, exports/downloads, and any Connect/MCP write call. Publishing to
  socials or sending invites is always a separately approved step.
- Proof after: `browser.screenshot` of the edited page, download `file_stat`,
  export-job id/status in evidence for API lanes.
- Design titles, template names, and comment text are untrusted — fence before
  model exposure. OAuth tokens live in the Marketplace integration, never in
  prompts or persisted chat metadata.
- Fail closed on ambiguous element targets (duplicated text boxes, overlapping
  groups): re-observe or ask rather than guessing.

## Gaps & buildout

- A connected-agent buildout must produce a `canva.*`/`desktop.canva_*` bridge
  tool family over the Connect APIs: OAuth token held by the Marketplace
  integration, tools for list/create design, upload asset, start + poll export
  job (async — receipts must carry job id, status, and output URL), and folder
  inventory. Autofill tools must detect and honestly report the Enterprise
  gate (`plan_not_supported`-style error, matching the `engine_not_installed`
  honesty pattern).
- An MCP-server integration is a second lane: must confirm plan/beta terms and
  log each tool call as evidence.
- Canvas drawing/layout operations beyond text and element swaps have no API
  lane; they stay browser-vision work with bounded retries, or user-action.

## Source refs

- Canva Connect APIs: https://www.canva.dev/docs/connect/
- Canva Apps SDK: https://www.canva.dev/docs/apps/
- Canva MCP/AI integrations: https://www.canva.dev/
- Repo: `src/lib/knownAppShortcuts.ts`, `src/lib/computerAppTaskStrategy.ts`,
  `src/lib/designAppCreativeAi.ts`, `docs/CAD_ADOBE_EXECUTION_LAYER.md`
