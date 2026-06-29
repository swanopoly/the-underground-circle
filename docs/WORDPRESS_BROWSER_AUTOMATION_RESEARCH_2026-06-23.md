# WordPress + Browser Automation — Research & Wave-2 Planning Brief

**Date:** 2026-06-23
**Source:** Fact-checked multi-agent research wave (`wf_2963ba88-f00`, 15 agents). Every finding below was researched against current (2025-2026) Browserbase / Stagehand / WordPress / Anthropic docs **and** verified against the repo, then independently re-checked by an adversarial fact-checker. Claims marked _unconfirmed_ in the original pass are quarantined under **Open Questions** — do not build against them.

> This is a planning input for the next development wave. It does **not** itself change code. Canonical ownership/sequencing still defers to `docs/AGENTS_ROADMAP.md`.

## Self-verified structural findings (confirmed by direct grep)

- **Wrong Browserbase host + undocumented bridge.** `supabase/functions/computer-use-agent/index.ts` calls `https://www.browserbase.com/v1/sessions` (:1340) and an undocumented `/v1/sessions/{id}/commands` screenshot/click REST bridge (:1426), and hand-builds the live URL (:504, :1358). Documented surface is `api.browserbase.com` + a CDP `connectUrl`. The code comment at :71 already documents the screenshot-only limitation. **This gates Contexts, live-view, and uploads.**
- **Stagehand installed but unwired.** `@browserbasehq/stagehand ^3.2.1` is in `package.json` with **zero imports** anywhere — a built-but-unused executor seam.
- **REST mutation path is ungated.** `handlePublish`/`handleDelete` (`src/lib/wordpressChatCommands.ts`) mutate with no approval / origin / `allowed_actions` enforcement, while the browser login path is well-gated — an asymmetric, live security gap.

## Constraints carried into any build

- **Root-owned / not editable:** `src/lib/wordpressRestPayload.ts`, `src/lib/wordpressAdminSourceIntelligence.ts`. Payload-field changes (e.g. `date_gmt`, ACF) must route through a writable wrapper or a `chown` request.
- **Smoke-test rule:** any new pure logic must live in a dependency-light module (`import type` only) so tsx/esbuild can load it; wire a smoke into `package.json`.
- **Do NOT:** code against `rankmath/v1/updateMeta` (hallucinated), add auto-CAPTCHA-solving, or duplicate REST-first routing (it largely already exists in `chatComputerRequestRouter.ts` + the `wordpress_cms` pipeline).

## Recommendations

Legend — value implied by ordering within group; **E** effort (s/m/l), **R** risk, **C** confidence.

### WordPress REST correctness (low-risk, confirmed failure modes)

| ID | Title | E/R/C | Files |
|----|-------|-------|-------|
| R3 | Schedule via `date_gmt` (fix wrong-hour publishing) | s / low / 0.92 | `wordpressChatCommands.ts` handleSchedule; payload field is root-owned → wrapper |
| R1 | SEO-meta writability preflight + honest blocker (stop silently no-op'ing Yoast/Rank Math meta) | m / low / 0.90 | `wordpressChatCommands.ts` handleAIWrite; `computerTaskEvidenceContract.ts` |
| R2 | Provider-detecting SEO adapter (rest_writable / needs_admin_browser / needs_buildout) — never assume a native write route | m / low / 0.85 | new pure module → `wordpressChatCommands.ts`, `computerAppTaskStrategy.ts` |
| R7 | Pagination loop (`X-WP-TotalPages`) + error-vs-empty tuple in list helpers | m / low / 0.88 | `siteAutomation.ts` fetchCategories/Tags/listPosts |
| R6 | Robust media upload (raw binary + `Content-Disposition`; alt/caption as follow-up POST) | m / low / 0.82 | `siteAutomation.ts` uploadWordPressMedia; `wpAdmin.ts` uploadMedia |
| R5 | CPT `rest_base` discovery before posting (stop hardcoding `flavor_di_slides`); fail over to wp-admin on `show_in_rest=false` | m / low / 0.85 | `wpAdmin.ts` (discoverPostTypes exists but uncalled) |
| R4 | `context=edit` / `content.raw` for any body-edit feature (never re-POST rendered HTML) | s / low / 0.88 | `siteAutomation.ts` get/listPost; `wordpressChatCommands.ts` handleEdit |
| R24 | Internal-linking + validated-slug features on core REST primitives | m / low / 0.82 | `siteAutomation.ts`, `wordpressChatCommands.ts` (payload via wrapper) |

### WordPress content / SEO workflow

| ID | Title | E/R/C | Files |
|----|-------|-------|-------|
| R23 | Approvable field-level SEO/content preview card before publish | m / low / 0.80 | `wordpressChatCommands.ts` handleAIWrite; `wordpress_cms` pipeline |
| R22 | Post-Yoast-write reconcile / "frontend may be stale" notice (indexables cache) | m / low / 0.80 | evidence contract; wp-admin fallback |

### Browserbase platform (R8 is the gating, high-risk item)

| ID | Title | E/R/C | Files |
|----|-------|-------|-------|
| R8 | Migrate off `www.browserbase.com` `/commands` → `api.browserbase.com` + CDP `connectUrl` (or Stagehand). **Gates R9/R11/R12.** | l / **high** / 0.85 | `computer-use-agent/index.ts` |
| R9 | Wire Browserbase Contexts for persistent encrypted WP login (consume `requiresPersistentContext`) | m / med / 0.82 | `computer-use-agent/index.ts`; `browserbaseWorkflowIntent.ts` |
| R11 | Real live-view `/v1/sessions/{id}/debug` URL for 2FA/CAPTCHA takeover | m / low / 0.85 | `computer-use-agent/index.ts`; `computerUse.ts` |
| R10 | `keepAlive` + `timeout` at create; explicit release; honor `retry-after` | m / low / 0.85 | `computer-use-agent/index.ts` |
| R26 | Browserbase-side cost (browser-minutes/proxy-GB) + replay/userMetadata capture into run records | m / low / 0.72 | `computer-use-agent/index.ts` |
| R12 | Browser file-upload action (Uploads API + CDP `setFileInputFiles`) — needs R8's CDP channel | m / med / 0.75 | `computer-use-agent/index.ts` |

### Stagehand

| ID | Title | E/R/C | Files |
|----|-------|-------|-------|
| R13 | Stand up the installed-but-unwired Stagehand executor over CDP (observe→act, extract+Zod → EXTRACTED_DATA) | l / med / 0.78 | `computerUse.ts`; routing in `browserbaseWorkflowIntent.ts` |

### Browser reliability

| ID | Title | E/R/C | Files |
|----|-------|-------|-------|
| R14 | Enforce post-action validation as a runtime gate (observe→act→**verify**), not advisory prompt text | m / low / 0.82 | `scripts/browser-bridge.js`; evidence contract; edge prompt |
| R15 | Complete the semantic-locator ladder (getByLabel/Placeholder/AltText/Title/TestId before CSS) | m / low / 0.85 | `scripts/browser-bridge.js` resolveLocator |
| R16 | Bounded single retry on transient UI-target errors keyed to fresh re-observation (add "not stable") | m / low / 0.80 | `scripts/browser-bridge.js`; evidence contract |
| R17 | Idempotency / double-submit protection for retried mutations (verify proofAfter before re-firing; dedupe by slug/title/hash) | m / low / 0.78 | `computer-use-agent/index.ts`; `browser-bridge.js`; `wpAdmin.ts` |
| R25 | Parity: passkey/WebAuthn + push-2FA detectors in the local bridge; re-verify after Done | s / low / 0.80 | `scripts/browser-bridge.js` VERIFICATION_DETECTORS |
| R18 | First-class HTML cookie/consent overlay dismissal (reject-by-default; vendor Autoconsent-style rules) | l / med / 0.71 | `scripts/browser-bridge.js` |

### Security

| ID | Title | E/R/C | Files |
|----|-------|-------|-------|
| R19 | Bring REST mutations under the vault approval/origin/`allowed_actions` policy; add publish/delete to the taxonomy | l / med / 0.82 | `wordpressChatCommands.ts`; `siteAutomation.ts`; `vaultAgentAccess.ts` |
| R20 | Stop leaking credential errors / raw REST bodies to chat/logs; redact; gate `rest_not_logged_in` server-config notice | m / low / 0.85 | `wpAdmin.ts`; `siteAutomation.ts` |
| R21 | Standardize runtime credential resolution on the Supabase vault (treat 1Password as import-only) | l / med / 0.78 | `wpAdmin.ts`; `siteAutomation.ts` |

## Risks & sequencing

- **R8 is high-risk and load-bearing** — sequence it first, behind a feature flag, keeping the existing REST `/commands` path as fallback until CDP is proven against the live account. **Verify the `/commands` endpoint truly doesn't exist on the live account before removing it** (docs absence ≠ account absence).
- Root-ownership blocks in-place edits to `wordpressRestPayload.ts` / `wordpressAdminSourceIntelligence.ts` (R3, R24, R20-redaction) → wrapper or `chown`.
- The REST security gap (R19/R20) is **present today** in `handlePublish`/`handleDelete` and `wpAdmin.ts` — not theoretical.
- Keep **fail-to-human** as default; do not enable auto-CAPTCHA-solving (conflicts with the verification gate).
- Treat Stagehand server-side caching as a DOM-hash-validated optimization, not correctness (open issue #1767).

## Open questions (verify before building)

1. Does the **live** Browserbase account actually lack `/sessions/{id}/commands`? (gates R8 removal)
2. Stagehand "hosted REST API" is **unconfirmed** — it appears to be an SDK/CDP library; verify before designing R13 around a hosted surface.
3. Browserbase **Downloads** object-model specifics unverified (only the Uploads half of R12 is solid).
4. Browserbase **lifecycle webhooks** likely absent — R26 uses polling + replay deliberately.
5. Whether instruction-before-image ordering / an iteration cap already exist in the edge message assembly.
6. `redactText` export/import-safety from the root-owned `wordpressAdminSourceIntelligence.ts` (needed by R20); `vaultImport.ts` capability (R21).
7. Whether the specific Dealer Inspire slide CPT is `show_in_rest=false` — confirm at runtime via `/wp/v2/types` (R5), don't hardcode.
8. Whether `scripts/browser-bridge.js` injects manual sleeps that defeat Playwright auto-wait (relevant to R16).
