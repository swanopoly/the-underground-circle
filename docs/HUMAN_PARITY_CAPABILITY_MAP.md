# Human-Parity Capability Map

> Created: 2026-07-02 (P13). Updated 2026-07-06 (P14: all six build-order gaps
> closed). The question this doc answers: *"Can a person create/do anything
> through chat that they could do on a computer?"* — what works today, through
> which pipeline, and exactly what's missing. Grounded in code (owners cited);
> update when a lane ships.

## Creation matrix

| Create… | Status | Entry (novice) | Pipeline owner | Notes |
|---|---|---|---|---|
| Webpage / landing page | ✅ | `/create a landing page…` → `/build-page` | buildStream + ChatBuildStudio + Netlify deploy | Streamed, live-edit, deployable |
| Code / script / component | ✅ | `/create a python script…` | plain-chat coding lane → code artifact → workspace/room | Artifact → "Create Workspace" → git project |
| Code project (repo) | ✅ | code artifact → workspace | chatWorkspace.createWorkspaceFromArtifact | Push to GitHub via /gh |
| Image / logo | ✅* | `/create a logo…` → `/imagine` | modelCapabilities routeByCapability → HF Flux/SDXL or Gemini | *Needs HF key or GEMINI env; failures now name the backend + next action (P14 `fallbackNotice`) |
| Document (resume, proposal…) | ✅ | `/create a resume…` | plain chat → markdown artifact download; `docs.create_document` tool → real Google Doc when Drive is connected | Doc creation is approval-gated (publish); token auto-refreshes via google-oauth `?action=token` (P14) |
| Spreadsheet / CSV | ✅ (native, P14) | `/create a spreadsheet of…` | createChatCommand directive → csv artifact auto-upgraded to `table` kind (tableArtifact.ts) → rendered grid + Download CSV | Clamp 200×30 rendered; full data preserved in content |
| WordPress post/page | ✅ | `/create a blog post on my wordpress…` | wp.* tools, approval-gated publish | Full REST integration |
| Images → WordPress media | ✅ (P20) | paste/drag images + "post these to my wordpress" (wp-admin URL ok) | wpImagePostFlow directive → wp.upload_media from storage paths | DI subdir URLs normalized; drafts by default; approval per write; connect guidance = app password → 1Password |
| Task / mission | ✅ | `/create a task for…` → `/task new` | missions + receipts loop | Receipts post back to chat (P3c) |
| Recurring watch | ✅ | `/create a daily watch…` → `/watch` | computerTaskSchedules + server scheduler | Read-only floor enforced |
| Automation | ✅ | `/create an automation…` → `/automation` | automation builder wizard | Approval-gated |
| Design (Photoshop/InDesign) | ✅ core ops (P15) | describe it (design wording routes) | designAppExecutionPipeline + ExtendScript adapters (photoshopExtendScriptAdapters via bridge) | Executable now: adjustment layers, Select Subject/mask (background removal core), resize/canvas/crop + the 6 P13-era tools. Still gapped: generative fill (Firefly), layer effects, smart objects. Approval + proof gates throughout; never auto-saves |
| CAD part / conversion | ✅ code-CAD (P15) | describe the part or conversion | engineeringCadOperationRunbooks + cadCodeExecutor → desktop.cad_compile | New parts via OpenSCAD (STL + PNG proof); STEP/FCStd/DXF conversion + inspection via FreeCAD headless; cad_inspect_file reads STL/DXF/STEP structure with no app. Requires OpenSCAD/FreeCAD installed (honest install hints otherwise); editing existing app documents still routes app-native/buildout |
| Presentation / slide deck | ✅ (P14) | `/create a slide deck…` → `/build-page` deck template | createChatCommand presentation lane → live builder (single-file HTML deck: arrow-key nav, slide counter, print-stylesheet) | Print → Save as PDF exports the deck; `.pptx` honestly not supported (note says so) |
| Google Doc / Drive file | ✅ (P14) | ask for a Google Doc (agent tool) | googleDocsCreate.createGoogleDocFromMarkdown → Drive v3 multipart (HTML→Doc); OpenSwan tool `docs.create_document` | Approval-gated (publish, external side effect); needs Drive scope; 60k char bound |
| Local desktop file write | ⚠️ gated | agent route only | desktop bridge + grants/approval | Deliberately strict; not a discovery gap |
| Video | ❌ | — | — | Out of scope near-term |

## Review & analysis matrix

| Do… | Status | Entry | Owner |
|---|---|---|---|
| Code-review a PR | ✅ (P13) | `/review <url|#n|latest> [focus]` or paste a bare PR link | reviewChatCommand → github.ts diff/files → code-reviewer soul methodology (correctness→security→design→style, 🔴/🟡/💭), untrusted-fenced diff, read-only |
| Post review findings to the PR | ✅ (P14, opt-in) | `/review … --comment` | reviewChatCommand files a `chat.review_comment` approval → agentApprovalsWorker posts via createPullRequestComment after human approval; body bounded + attributed |
| PR link mid-sentence | ✅ (P14) | paste a PR URL anywhere in a message | ChatTab affordance: detectGithubPrUrl → one-tap `/review <url>` quick-reply chip; the message itself still flows normally |
| Browse repo / diff branches | ✅ | `/gh tree|cat|diff|prs|commits` | githubChatCommands + github.ts |
| Research with sources | ✅ | research intent → Perplexity/strong lane | Auto router research lane |
| Compare models on a task | ✅ | `/bestof` | bestOfNRace + judge |
| Watch a page for changes | ✅ | `/watch` | scheduler + computerRunDiff |
| Browser/app automation | ✅ | describe it | computer-use pipeline (Sonnet-pinned loop, approval floor, steering) |
| Review own circle state | ✅ | status/memory questions → BlackSwan | P8 auto lanes |
| Check app automation reachability | ✅ (P17) | `/apps` or `/apps <name>` | appsChatCommand + appReachabilityProbe (live ladder: bridge/installed/running/focus/a11y, stale-bridge detection) |
| Examine an app screen + get next step | ✅ (P17/P19) | `/screen [app]` for users; agents call `desktop.observe_app` | one round trip: window state + a11y tree + Δ diff + deterministic next-step advisor; /screen renders it novice-friendly with fix chips |
| Watch a local folder | ✅ (P19) | `/watch my Downloads folder for new pdfs` | folderWatchModel + client schedule runner (bridge listFiles snapshot diff); server scheduler skips local watches; runs while the app is open |

## Build-order gaps — all closed in P14 (2026-07-06)

1. **Proper `table` artifact kind** — DONE: `tableArtifact.ts`
   (parseCsvText/tableToCsv/looksLikeCsvArtifact), `table` in swanbot's
   artifact union + both parse gates upgrade csv→table, grid render +
   Download CSV in ChatArtifacts. Smoke: `smoke:table-artifact`.
2. **Google Docs/Drive creation tools** — DONE: `googleDocsCreate.ts`
   (Drive v3 multipart, markdown→HTML converter, typed errors, token never
   in error strings) + `docs.create_document` in openswanToolRuntime
   (publish approval). Durability: google-oauth edge fn gained
   `?action=token` (refresh-and-return using the stored refresh_token;
   refresh_token never reaches the client) and the default resolver falls
   back to it on expiry. Smoke: `smoke:google-docs-create`.
   *Ops: redeploy `google-oauth` for the token route.*
3. **Presentations** — DONE: `/create` presentation lane re-dispatches to
   `/build-page` with a deck-template brief (one section per slide,
   arrow-key + click nav, slide counter, print-one-slide-per-page CSS so
   Print → PDF is the export). Note stays honest that `.pptx` isn't
   supported.
4. **Image reliability** — DONE: `routeByCapability` returns a
   `fallbackNotice` naming which backends were tried (or that none is
   configured, pointing at Marketplace) when ALL image backends fail;
   ChatTab shows it before the normal text fallback. Still `handled:false`
   so the tiered path recovers — no dead ends. Never includes key material.
5. **Review round 2 (`--comment`)** — DONE: opt-in flag files a
   `chat.review_comment` approval (payload owner/repo/number/body ≤8k,
   1h expiry); `agentApprovalsWorker.applyApprovedReviewCommentAction`
   posts on approval with attribution footer. WRITE stays human-gated.
6. **PR-link quick action** — DONE: mid-sentence PR URLs get a localOnly
   notice with a `/review <canonical-url>` quickReply chip; solo links
   still auto-review (P13).

Remaining (not scheduled): `.pptx`/Slides export via a future Drive/Slides
tool; Replicate image lane (deliberately disabled in llm-proxy to avoid
provider drift); video.

## Non-negotiables carried through every lane

- Consequential actions (publish/pay/delete/login/grant) keep their
  approval gates no matter which entry routed there — `/create` and
  `/review` re-dispatch through the SAME planner/dispatcher, never around
  it. `docs.create_document` and `--comment` are both approval-gated
  writes.
- Honesty over pretending: unsupported lanes say so and offer the nearest
  real alternative, and every routing hop posts a one-line note
  ("🪄 Creating via live builder…"). The deck lane's note names the
  `.pptx` limitation; image failures name the backend that failed.
- Everything above is pinned by smokes: `smoke:create-chat-command` (162
  cases), `smoke:review-chat-command` (23 blocks), `smoke:table-artifact`,
  `smoke:google-docs-create`, `smoke:model-capabilities` (fallbackNotice),
  `smoke:swanbot-v2-workspace` (table lockstep), and the novice persona
  batteries 8–9.
