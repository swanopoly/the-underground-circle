# Universal App + Web Control — Research & Plan (2026-04-23)

> Deep research on what it takes for an agent to "make changes in any native app
> and on any website." Maps the state of the art to The Underground Circle's
> existing stack and proposes a phased rollout.
>
> **Status:** Research complete. Phase UC-1 (accessibility tree) is the
> recommended next ship.

---

## Where we stand today

| Capability | Status | Where |
|---|---|---|
| Launch / focus / type / press-keys / screenshot / click-at / open-url / open-path / screen-size | Shipped | `scripts/claude-bridge.js` (port 7778, token-paired, macOS) |
| Known-app aliases w/ macOS bundle-name resolution | Shipped | `src/lib/knownAppShortcuts.ts` |
| Auto-chain for multi-step "open X and do Y" (Terminal + Claude, Zoom + Cmd+N) | Shipped | `src/lib/computerAppAdapter.ts` |
| Client-delegated tool protocol (edge → client → bridge) | Shipped | `swanbot-v2-ai` + `src/lib/swanbot.ts` |
| Anthropic computer-use agent (vision-only escape hatch) | Shipped (separate edge fn) | `supabase/functions/computer-use-agent/` |
| 1Password CLI credential proxy | Shipped | `scripts/claude-bridge.js` `/secrets` + `src/lib/credentialService.ts` |
| HITL approval queue + in-chat banner | Shipped | `agent_run_approvals` + `RunApprovalBanner.tsx` |
| `/desktop diag` health checklist | Shipped | `src/lib/desktopBridgeDiag.ts` |

**Current grounding model:** pure-vision on pixels. We screenshot, pass it to
Claude, the model returns `(x, y)` coordinates, we click. This is the same path
Anthropic's hosted computer-use uses internally — expensive per step, brittle
to window resize, blind to elements outside the screenshot.

---

## What "any app, any website" actually requires

The field has consolidated around four grounding strategies. Every serious 2026
agent picks one as primary and falls back to the others:

1. **Accessibility tree** — semantic `{role, label, value, bbox}` tree from the
   OS (macOS `AXUIElement`, Windows UI Automation, Linux AT-SPI). Cheap,
   stable, works when the app exposes it well.
2. **DOM / ARIA roles** (web only) — same idea for browsers; Playwright's
   `getByRole` + accessibility snapshot is the canonical form.
3. **Vision / pixel grounding** — screenshot + VLM picks coordinates. Slow,
   expensive, but the only thing that works on canvases, games, custom
   renderers, and native drawing surfaces.
4. **Programmatic APIs** — official SDKs, REST, MCP servers, URL schemes.
   Always preferred when available because they skip the UI layer entirely.

**Top labs' grounding mix (April 2026):**

| System | Primary | Fallback | Benchmark |
|---|---|---|---|
| Anthropic computer-use (Claude 4) | Vision | — | OSWorld-Verified: Opus 4.7 **78%**, Sonnet 5 **88.3%** (above human 72.4%) |
| OpenAI CUA / Operator | Vision + DOM hybrid | Vision | OSWorld 38.1%, WebArena 58.1%, WebVoyager 87% |
| Google Project Mariner | DOM + a11y | Vision | WebVoyager 83.5%, 10-task parallel, Teach-&-Repeat |
| Skyvern 2.0 | DOM + vision | Vision | WebVoyager 85.85%, Web-Bench SOTA 64.4% |
| browser-use (OSS, 89.5k⭐) | DOM + Playwright | Vision | Fortune-500 production |

**Berkeley RDI benchmark caveat (2026):** 8 major agent benchmarks including
WebArena, OSWorld, GAIA have been shown exploitable via leaked refs,
prompt-injectable LLM judges, and unsanitized `eval()`. Treat leaderboards as
*signal, not proof* — real-user task completion is the only ground truth.

---

## The 10x missing piece: `/desktop/a11y_tree`

Our bridge currently gives the model **coordinates and pixels**. The gap isn't
"we can't open apps" (we ship that). It's that the model pays ~1,500 tokens
per screenshot and has to reason about pixel positions.

**Adding one endpoint** — `GET /desktop/a11y_tree?app=<name>` returning a
pruned JSON tree of the frontmost (or named) app — unlocks:

- **Token cost:** ~400 tokens for a pruned tree vs ~1,500 for an XGA screenshot.
  On a 50-step task at Opus 4.7 rates, that's roughly $0.15 vs $0.60+ on input
  tokens — **~75% reduction**.
- **Selector stability:** `role=button, label="Send"` survives window resize,
  theme change, and retina/non-retina mix. Pixel coordinates don't.
- **HITL UX:** approval banner can show "click Send button" instead of
  "click (734, 412)" — a huge legibility win for the wallet-gated UC app.
- **Teach-by-demo:** combined with coordinates we already have, a demo can be
  replayed against *semantic* selectors. This is how Mariner's "Teach & Repeat"
  works.
- **Regression-proof skills:** a skill recorded as "click #send-button" survives
  Slack's next redesign; a pixel-coord skill doesn't.

### Implementation options (macOS)

| Option | Pros | Cons |
|---|---|---|
| **Swift helper binary** (ship with bridge) | First-class `AXUIElement` API, fast, scoped bundle | Need to compile + sign per arch |
| **`MacPaw/macapptree`** subprocess ([repo](https://github.com/MacPaw/macapptree)) | Zero integration, prebuilt, battle-tested | Python/Swift dep to ship |
| **`ahkohd/macos_accessibility_client`** | npm, node-native | Only wraps trust-check; doesn't walk the tree |
| **JXA bridge for scriptable apps** | Works for apps with scripting dict (Mail, Finder, Safari, Terminal, Notion's partial) | Covers ~20% of apps; not a general solution |

**Recommendation:** thin Swift helper compiled to a universal binary we ship
inside a signed `.app` bundle. Spawn as subprocess from the bridge, IPC via
stdout JSON lines. Precedent: every desktop a11y product (Raycast, Arc,
Shortcat, Flow) ships a tiny Swift helper for this exact reason.

### Security: the signed-bundle move

Right now, granting Accessibility to `/usr/local/bin/node` grants it to every
npm package the user ever runs. OpenClaw hit a public incident on this in
March. Wrapping `claude-bridge.js` as a signed `.app` with embedded Node
scopes the AX grant to our bundle ID — fixes the security posture *and*
upgrades App-Store credibility for the Mac-native UC app we're building toward.

---

## Phase plan — UC-1 through UC-5

### Phase UC-1 — Accessibility tree endpoint (SHIPPED 2026-04-23)

- Swift helper compiled to universal binary, bundled with the bridge.
- Bridge endpoint `GET /desktop/a11y_tree?app=<name>&max_depth=6` returning
  `{ ok, app, nodes: [{ id, role, label, value, bbox, children_ids }] }`.
- Pruning: skip `AXUnknown`, empty containers, anything off-screen; cap depth
  at 6; cap total nodes at ~150.
- New desktop tool `desktop.read_a11y_tree` registered in `swanbot-v2-ai`.
- Model prompt update: "prefer `desktop.read_a11y_tree` → find element by
  label/role → `desktop.click_element(id)` over `desktop.screenshot` +
  `desktop.click_at(x, y)`."
- New endpoint `POST /desktop/click_element` that resolves `id` from the last
  tree fetch and clicks the centre of its bbox. 10-second cache of last
  tree per app.
- HITL banner upgrade: render element-labelled actions instead of coords.
- Smoke coverage: a11y-tree parser tests (we can fixture-test against a
  canned tree shape even without a Mac in CI).

### Phase UC-2 — Signed `.app` bundle for the bridge

- Package `claude-bridge.js` + Node + Swift helper as `UC Desktop Bridge.app`.
- Developer ID signed + notarised.
- Expose a simple menu-bar presence (start/stop/status), status-chip in UC
  web app gets a "Download bridge" button when unpaired.
- Migration plan: existing `node scripts/claude-bridge.js` keeps working; new
  bundle is recommended path. Bundle and the script share the same
  `~/.uc-desktop-token` so pairing doesn't need redo.

### Phase UC-3 — Browser automation via persistent Chrome profile (SHIPPED 2026-04-23)

- New `/browser/*` surface on the bridge backed by Playwright with
  `launchPersistentContext({ userDataDir: '~/Library/Application Support/UC/Chrome' })`.
- Endpoints: `open_url`, `dom_snapshot` (aria tree), `click_role`, `fill`,
  `press`, `screenshot_page`, `wait_for_selector`.
- Reuses the user's real Chrome logins / passkeys / 2FA — kills 80% of the
  CAPTCHA pain without residential proxies.
- Tool names mirror desktop ones: `browser.click_role`,
  `browser.fill_field`, etc. Registered as clientOnly in v2.
- Rationale to skip hosted runtimes (Browserbase ~$50/mo, Steel ~$29/mo,
  Scrapybara): we already own the better surface (user's own authenticated
  browser). Revisit if we ship a "UC Cloud" tier.

### Phase UC-4 — Record + replay (teach-by-demo)

- Chat command `/record` starts a recording session that captures every
  `desktop.*` + `browser.*` tool call made in the current chat turn AND
  the a11y-tree snapshot at each step.
- On `/record stop`, we persist the trace as a SKILL.md entry with:
  - Ordered steps (element + action + input)
  - A11y tree snapshots per step (so later replay can fuzzy-match)
  - Screenshot fallback per step (canvas / image steps)
- Replay via `skill.run <name>` — deterministic for a11y-grounded steps,
  vision fallback for pixel-only steps.
- This is Project Mariner's "Teach & Repeat" without Google.

### Phase UC-5 — Anthropic computer-use as fallback router

- Keep `computer-use-agent` edge fn.
- New routing rule in `computerAppAdapter`: if a11y-tree-grounded attempt
  returns `element_not_found` twice in a row, or the task explicitly targets
  a canvas / game / image-editor, hand off to vision-first computer-use.
- Computer-use is ~3-5x more expensive per step; this keeps it warm only
  when we actually need it.

---

## Deliberately deferred (and why)

| Thing | Why defer |
|---|---|
| **Hosted browser runtimes** (Browserbase, Steel, Scrapybara) | User's own machine is a strictly better surface (real sessions, real creds) until we offer server-side "UC Cloud" agents — revisit then. |
| **CAPTCHA services** (2Captcha, Anti-Captcha) | ~$1.45 / 1,000 Turnstile solves but tokens are tied to IP+UA+TLS fingerprint. Persistent-profile + user network sidesteps nearly all of it. |
| **Residential proxies** (Bright Data, Oxylabs) | Only matters for scraping-at-scale use cases UC isn't chasing; legal surface (Meta v. Bright Data) is active. |
| **Anti-bot evasion / fingerprint randomisation** | User is logged in as themselves — no evasion needed. If you're fighting anti-bot, you're in a different product. |
| **OSWorld / WebArena benchmarking harness** | Leaderboards are exploitable (Berkeley RDI 2026). Real task completion on UC user flows is the only signal that matters. |
| **Windows / Linux bridges** | Desktop UC users are Mac-heavy right now; Windows `pywinauto` port is a fork-and-adapt job, not a research problem. Phase UC-6 when demand shows. |

---

## Benchmarks snapshot (April 2026)

| Bench | Leader | Score | Source |
|---|---|---|---|
| OSWorld-Verified | Claude Sonnet 5 | **88.3%** | [llm-stats](https://llm-stats.com/benchmarks/osworld-verified) |
| OSWorld-Verified | Claude Opus 4.7 | 78.0% | [llm-stats](https://llm-stats.com/benchmarks/osworld-verified) |
| OSWorld-Verified | Human baseline | 72.4% | [OS-World](https://os-world.github.io/) |
| WebArena (BenchLM mirror) | Claude Mythos Preview | 68.7% | [BenchLM](https://benchlm.ai/benchmarks/webArena) |
| WebVoyager | OpenAI CUA / Skyvern 2.0 | 87% / 85.85% | [OpenAI CUA](https://openai.com/index/computer-using-agent/), [Skyvern](https://www.skyvern.com/blog/web-bench-a-new-way-to-compare-ai-browser-agents/) |
| WebVoyager | Project Mariner (Gemini 3) | 83.5% | [DeepMind](https://deepmind.google/models/project-mariner/) |
| Web-Bench (Skyvern) | Skyvern 2.0 | 64.4% | [Skyvern](https://www.skyvern.com/blog/web-bench-a-new-way-to-compare-ai-browser-agents/) |
| Online-Mind2Web | OpenAI Operator | 61% | [arxiv](https://arxiv.org/html/2504.01382v4) |

---

## Key references

- [Anthropic computer use docs](https://docs.anthropic.com/en/docs/build-with-claude/computer-use)
- [Anthropic pricing (platform)](https://platform.claude.com/docs/en/about-claude/pricing)
- [MacPaw macapptree (macOS a11y walker)](https://github.com/MacPaw/macapptree)
- [node-mac-permissions](https://github.com/codebytere/node-mac-permissions)
- [pywinauto (Windows UIA + AT-SPI branch)](https://github.com/pywinauto/pywinauto)
- [Playwright AI ecosystem 2026](https://testdino.com/blog/playwright-ai-ecosystem/)
- [Playwright BiDi blockers](https://github.com/microsoft/playwright/issues/32577)
- [browser-use GitHub](https://github.com/browser-use/browser-use)
- [Skyvern Web-Bench](https://www.skyvern.com/blog/web-bench-a-new-way-to-compare-ai-browser-agents/)
- [OmniParser v2 — Microsoft](https://github.com/microsoft/OmniParser)
- [Tricentis on Anthropic + OmniParser](https://www.tricentis.com/blog/why-we-bet-on-anthropic-part-2)
- [Simon Willison on computer use](https://simonwillison.net/2024/Oct/22/computer-use/)
- [Illusion of Progress — Online-Mind2Web](https://arxiv.org/html/2504.01382v4)
- [Project Mariner — DeepMind](https://deepmind.google/models/project-mariner/)
- [E2B pricing](https://e2b.dev/pricing)
- [Browserbase pricing](https://www.browserbase.com/pricing)
- [Scrapybara + Anthropic Act SDK](https://docs.scrapybara.com/anthropic)
- [OpenAI CUA blog](https://openai.com/index/computer-using-agent/)
- [2Captcha Turnstile](https://2captcha.com/p/cloudflare-turnstile)
- [Bright Data vs Oxylabs 2026](https://use-apify.com/blog/bright-data-vs-oxylabs-2026)

---

## TL;DR

- **Ship UC-1 (a11y tree) next** — it's the single highest-leverage move and
  compounds every other capability.
- **Ship UC-2 (signed bundle)** right after — security posture + App-Store
  credibility.
- **UC-3 persistent Chrome profile** kills 80% of the web-automation pain
  without residential proxies or CAPTCHA services.
- **UC-4 record/replay** leapfrogs Mariner for desktop workflows once UC-1
  lands.
- **UC-5** keeps Anthropic computer-use as the vision-first escape hatch for
  canvases and games.

Don't chase hosted runtimes, anti-bot evasion, or benchmark gaming. The
user's own authenticated machine is a strictly better starting surface than
any hosted agent platform.
