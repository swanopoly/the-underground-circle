# WordPress + Browser Automation Buildout

> Roadmap and shipped log for hardening the WordPress integration, the local
> credential bridge, and the browser-action failure/verification layer.
> For Claude, OpenSwan, Codex, Gemini, and any agent extending this system.
> Last reviewed: 2026-06-26.
> Current status note: the planned `wp.inspect_admin_source` path has shipped
> as `browser.wp_admin_source_intelligence`, a local-browser read-only tool
> that parses page source into bounded/redacted WordPress and Dealer Inspire
> facts before generic DOM work. Treat this document's pre-pass section as
> historical context unless a row below is explicitly still marked planned.

## Why this exists

The WordPress and browser surfaces are where the accountability loop touches
live, credentialed, externally-visible state: a misfired `/wp publish` puts a
draft live, an unescaped AI paragraph can break post markup, and the local
`/secrets` bridge endpoint forwards values straight into the `op` CLI. This
pass closes the highest-value, lowest-risk gaps in those paths and records the
remaining planned work.

Every smoke-testable change lives in a **dependency-light pure module** (no
react-native import) so the logic is verifiable in plain Node even though the
runtime pulls react-native/supabase.

## Current state (historical pre-pass)

- **Credential bridge** — `scripts/claude-bridge.js` `/secrets` (POST) had no
  `isDesktopTokenValid` guard (unlike `/launch`, `/terminal/send`, `/spawn`)
  and interpolated `item`/`vault`/`fields`/`uri` into `execSync` shell strings.
  `src/lib/credentialService.ts` sent no `X-UC-Desktop-Token` header.
- **credentials.get policy** — fell through to the catch-all coordination
  policy in `openswanToolRuntime.ts` (`approvalMode: 'auto'`,
  `mutatesState: true`), so a secret-returning read was both ungated and
  mis-categorized; the lint smoke carried an allowlist hack to suppress the
  resulting false positive.
- **WordPress write quality** — `handleAIWrite` only mapped a meta description
  (Yoast + RankMath); no SEO title-tag or focus keyword. `wpBlock` text
  builders interpolated raw text into HTML. Media `alt_text` was only sent as a
  multipart field, which WP commonly ignores on media create.
- **WordPress mutation safety** — `handlePublish` / `handleDelete` /
  `handleSchedule` mutated live state with no confirmation step.
- **Browser failure layer** — `browserBridgeFailure.ts` dropped several explicit
  `DesktopBridgeError` codes (`ambiguous_locator`, `verification_gate`, the
  `a11y_*` codes, etc.) back to `unknown`, had no typed retry posture, and
  there was no advisory post-action verification planner.

## Roadmap

Grouped by category. Value/Effort/Risk are relative. `dev-now` items are the
cleared, surgical increments shipped (or attempted) this pass; `planned` items
are larger and need their own clearing pass.

### Security / credential bridge

| ID | Item | Value | Effort | Risk | Track |
|---|---|---|---|---|---|
| SEC-bridge-secrets | Token-gate `/secrets` + shell-safe `op` args (execFileSync argv + `isSafeOpArg`) + client token header | High | S | Low | dev-now |
| DEV-credentials-get-gate | Give `credentials.get` a dedicated approval-gated read-only `vault` policy | High | S | Low | dev-now |

### WordPress

| ID | Item | Value | Effort | Risk | Track |
|---|---|---|---|---|---|
| DEV-wp-write-quality | SEO meta (Yoast+RankMath title/desc/keyword) + escaping block builders + media `alt_text` follow-up PATCH | High | M | Low | dev-now |
| DEV-wp-prepublish | Pre-publish/delete/schedule confirm gate (`confirm` token) | High | M | Low | dev-now |
| PLAN-wp-browser-buildout | Agent-facing WP CRUD tools, REST-vs-admin-browser executor backing `browser.wp_admin_source_intelligence`, vault credential fallback, route-path field, advisor/audit wiring (fail-closed) | High | L | Medium | shipped/ongoing |

### Browser

| ID | Item | Value | Effort | Risk | Track |
|---|---|---|---|---|---|
| DEV-browser-reliability | Fill `browserBridgeFailure` code gaps + typed `retryability` + advisory post-action verification planner | Medium | M | Low | dev-now |

### Planned detail — PLAN-wp-browser-buildout

The larger WordPress/browser buildout (not shipped this pass; needs its own
clearing because it touches root-owned files and credentialed behavior):

- Agent-facing WP CRUD tools in `openswanToolRuntime.ts` (create/update/list
  posts/pages/CPTs) so chat agents act on WordPress through the typed tool loop
  rather than only `/wp` slash commands.
- A REST-vs-admin-browser executor that backs the shipped
  `browser.wp_admin_source_intelligence` path, routing through
  `computerAppTaskStrategy.ts` / `userTaskPipelines.ts` and parsing current
  wp-admin/Dealer Inspire page source into bounded facts before generic DOM
  snapshots or dashboard-only UI actions.
- Vault credential fallback (`credentials.get` → circle vault) when 1Password
  is unavailable.
- A route-path field carried on the chat computer route for WP tasks.
- Wiring `browserAIModalAdvisor` and an audit trail into the live path,
  fail-closed when evidence/observations are missing.

This item depends on edits to root-owned files
(`wordpressAdminSourceIntelligence.ts`, `wordpressRestPayload.ts`) or new
writable adapters, plus behavior-contract review for the new credentialed
tools, so it is deliberately deferred.

## Shipped this pass

All five cleared `dev-now` items landed. Pure logic lives in new
dependency-light modules with standalone smokes wired into `smoke:all`.

### SEC-bridge-secrets

- `scripts/claude-bridge.js` `/secrets` handler: added the standard
  `isDesktopTokenValid` 401 guard (same wording as `/launch`), an inline
  mirror of `isSafeOpArg` that rejects shell metacharacters / leading-dash
  flag injection before any `op` call, and switched the `op` invocations from
  `execSync` shell strings to `execFileSync('op', [...])` argv form (no shell
  interpolation; matches the existing `osascript` style).
- New pure module `src/lib/opSecretArg.ts` (`isSafeOpArg`, `assertSafeOpArgs`).
- `src/lib/desktopBridge.ts`: added an exported `getDesktopBridgeToken()`
  accessor (the token reader was previously private).
- `src/lib/credentialService.ts`: all three `/secrets` fetches now attach
  `X-UC-Desktop-Token` via a shared `buildSecretsHeaders()` that reuses the
  cached token / `ensureDesktopBridgePaired()` and fails gracefully when
  unpaired. (Client token ships together with the 401 gate so credential
  fetch does not regress.)
- Smoke: `scripts/secret-op-arg-smoketest.ts` (`smoke:secret-op-arg`).

### DEV-credentials-get-gate

- `src/lib/openswanToolRuntime.ts`: dedicated `credentials.get` policy branch
  — `family: 'vault'`, `approvalMode: 'ask'`, `mutatesState: false`,
  `approvalKind: 'privileged_action'` (identical fingerprint to the prior
  catch-all). Redacted vault reads (`vault.find`) stay `auto`; vault writes
  stay `ask`.
- `scripts/tool-description-lint-smoketest.ts`: removed the now-unused
  `credentials.get` allowlist entry (the `mutating-side-effect` rule no longer
  applies once `mutatesState` is false; the lint's stale-entry check would
  otherwise fail).
- Smoke: `scripts/credentials-get-policy-smoketest.ts`
  (`smoke:credentials-get-policy`).

### DEV-wp-write-quality

- New pure module `src/lib/wordpressContentMetadata.ts`: `escapeHtml`,
  `buildSeoMeta` (both Yoast + RankMath title/desc/keyword keys, absent fields
  omitted), and escaped block builders (`escapedParagraph/Heading/List/Quote/
  ImageAlt`).
- `src/lib/wordpressChatCommands.ts` `handleAIWrite`: prompt now also requests
  `SEOTITLE:`; parsed and fed (with the first tag as focus keyword) through
  `buildSeoMeta`. AI `content` is left unescaped.
- `src/lib/siteAutomation.ts`: `wpBlock` text builders delegate to the escaped
  variants (`html`/`code` keep raw behavior); `uploadWordPressMedia` fires a
  non-fatal JSON `alt_text` follow-up PATCH after upload.
- `src/lib/wpAdmin.ts`: `uploadMedia` accepts optional `file.altText` and fires
  the same non-fatal JSON `alt_text` follow-up.
- Smoke: `scripts/wordpress-content-metadata-smoketest.ts`
  (`smoke:wordpress-content-metadata`).

### DEV-wp-prepublish

- New pure module `src/lib/wordpressCommandRisk.ts`: `classifyWpCommandRisk`
  (action, mutating, targetId, confirm-token detection + stripping) and
  `buildWpConfirmPrompt`.
- `src/lib/wordpressChatCommands.ts` dispatcher: `publish`/`delete`/`schedule`
  now require a trailing `confirm` token. Without it, the command returns a
  preview prompt (resolving the post title for publish/delete) instead of
  mutating. Confirmed commands delegate to the unchanged handlers with the
  token stripped (schedule preserves title case). Draft/AI-write stay ungated.
  Help table updated.
- Smoke: `scripts/wp-command-risk-smoketest.ts` (`smoke:wp-command-risk`).

### DEV-browser-reliability

- `src/lib/browserBridgeFailure.ts`: `normalizeExplicitCode` now preserves the
  full set of explicit `DesktopBridgeError` codes (incl. `ambiguous_locator`,
  `verification_gate`, `a11y_tree_empty`, `a11y_path_stale`, `stale_bridge`,
  `helper_missing`, `origin_blocked`, `app_not_found`, `path_not_found`,
  `file_access_not_granted`, `platform_unsupported`); dedicated recovery hints
  + required-evidence for each; new optional `retryability` field +
  `browserBridgeRetryability()` helper populated in `describeBrowserBridgeFailure`.
- New pure module `src/lib/browserActionVerification.ts`:
  `planPostActionVerification` returns advisory post-state checks/evidence per
  action type. **Advisory only** — not wired into the mutating dispatchers;
  wiring it into live credentialed mutations is a separate, higher-risk item.
- Smokes: `scripts/browser-action-verification-smoketest.ts`
  (`smoke:browser-action-verification`) and extended
  `scripts/browser-bridge-smoketest.ts` (ambiguous_locator preservation +
  hint/evidence/retryability).

## Validation

- `npm run typecheck` — passes clean.
- New/affected smokes pass: `smoke:secret-op-arg`,
  `smoke:credentials-get-policy`, `smoke:tool-description-lint`,
  `smoke:wordpress-content-metadata`, `smoke:wp-command-risk`,
  `smoke:browser-action-verification`, `smoke:browser-bridge`.

## Constraints honored

- No edits to root-owned `wordpressAdminSourceIntelligence.ts` or
  `wordpressRestPayload.ts`.
- Approval fingerprints, tool names, and behavior contracts preserved
  (`credentials.get` keeps `privileged_action`; the advisory verification
  planner is not wired into live mutations).
- All smoke-testable logic lives in dependency-light modules.

---

# Wave 2 — shipped 2026-06-23

Six verified, low-risk items applied. All approval/proof gates and behavior
contracts preserved; no root-owned edits; new pure logic lives in
dependency-light modules with smokes wired into `package.json` + `smoke:all`.

## R25 — Passkey / WebAuthn + push-2FA detectors

- Appended two additive detectors to `VERIFICATION_DETECTORS` in
  `scripts/browser-bridge.js` (after the `login_challenge` entry): `passkey`
  (passkey/WebAuthn/security key/Windows Hello/Face|Touch ID/fingerprint/
  `navigator.credentials`/insert your security key) and `push_2fa` (tap yes on
  your phone / approve the notification / check your phone / we sent a
  notification to your device / open your authenticator app and approve).
- `face|touch id` is written as `/\b(?:face|touch)\s*id\b/i` so it cannot match
  a bare "face". Both kinds inherit `requiresHumanPause:true` /
  `canAutomate:false` from the shared return block and `human_verification_required`
  from `writeHumanVerificationPause` (mapped to `needs_user` by
  `browserBridgeFailure.ts`) — no per-kind plumbing, matching loop untouched.
- Smoke: new `scripts/browser-verification-detectors-smoketest.ts`
  (`smoke:browser-verification-detectors`), a manual mirror of the array.
  Note: "open your authenticator app and approve" also matches the existing
  `mfa` detector (earlier in the array) so it resolves to `mfa` — still a
  human-pause gate, same contract; the smoke asserts the pause regardless of
  kind and asserts a pure push phrase resolves to `push_2fa`.

## R15 — Semantic-locator ladder in `resolveLocator`

- `scripts/browser-bridge.js` `resolveLocator` keeps `selector` (rung 1) and
  name-as-CSS (rung 2) as top precedence, then before the `getByRole` default
  inserts strict-order optional rungs: `testId`→`getByTestId`,
  `label`→`getByLabel`, `placeholder`→`getByPlaceholder`,
  `altText`→`getByAltText`, `title`→`getByTitle`, each guarded by a non-empty
  string check, with `exact` forwarded where the API supports it (`getByTestId`
  has no exact option). The proposed `text`→`getByText` rung was intentionally
  DROPPED: `body.text` is the fill value and would corrupt fill resolution.
- Call sites and the upload caller's narrow `resolveLocator` use are untouched;
  new fields are `undefined` for existing callers.
- Smoke: extended `scripts/browser-locator-resolver-smoketest.ts` with
  `resolveLocatorPlan` and full precedence assertions plus a regression that
  `{role,name,text}` resolves to role+name (text ignored).

## R23 — Approvable field-level SEO preview card

- New pure `src/lib/wordpressSeoPreview.ts` (`buildSeoPreviewCard`) renders a
  compact markdown table: Title, Slug, SEO Title (title tag), Meta Description,
  Focus Keyword, Tags, Featured Image, Words. Empty fields render `(none)`;
  Slug renders `(auto from title)` (WP derives it server-side); meta desc
  truncated to 155 chars with a trailing ellipsis only on real overflow; pipe
  chars escaped so the table stays intact; SEO-title length hint when >60.
- Wired into `handleAIWrite` (`wordpressChatCommands.ts`): the post is still
  created as DRAFT and the card replaces the hand-rolled table, passing the
  same parsed values plus `focusKeyword: tagNames[0]` so the preview mirrors
  what `buildSeoMeta` actually wrote. The trailing
  `/wp publish <id> confirm` guidance stays; the live-publish confirm-token
  gate in `wordpressCommandRisk.ts` is unchanged (no new token name).
- Smoke: new `scripts/wordpress-seo-preview-smoketest.ts`
  (`smoke:wordpress-seo-preview`).

## R24a — Validated-slug helper in the WP write path

- New pure `src/lib/wordpressSlug.ts`: `slugify`, `normalizeSlug`,
  `resolveUniqueSlug(base, existingSlugs[])` (lowercase, non-alphanumeric→`-`,
  collapse/trim dashes, 60-char cap, `post` fallback, case-insensitive
  collision append `-2`/`-3`, bounded loop, no fetching).
- Wired into `handleDraft` and `handleAIWrite` via the writable
  `publishToWordPress({ ..., slug })` request (`WordPressPostRequest.slug`
  already forwards to the root-owned `buildWordPressPostBody`, so no root-owned
  edit). `existingSlugs` is `[]` this wave (no slug list is already fetched;
  adding a fetch is R7, deferred). R24b internal-linking NOT built.
- Smoke: new `scripts/wordpress-slug-smoketest.ts` (`smoke:wordpress-slug`).

## R1 — SEO-meta writability read-back + honest blocker

- New pure `diffPersistedSeoMeta(requested, returned)` in
  `wordpressContentMetadata.ts` returns `{persisted, dropped, blocker?}`:
  requested keys absent from / empty in the echoed meta count as dropped; an
  undefined returned meta drops all; the blocker stays honest (likely missing
  `show_in_rest` registration or plugin-owned server-side) and never fails the
  publish.
- `siteAutomation.ts`: additive optional `returnedMeta?: Record<string,unknown>`
  on `WordPressPostResult`, populated from `postData.meta` on the create
  response. `handleAIWrite` computes the diff and renders an honest SEO Meta
  row (None / Persisted (N) / Partial — persisted X, dropped Y) plus a blocker
  line under the card. Draft still exists regardless.
- Smoke: extended `scripts/wordpress-content-metadata-smoketest.ts`.

## R20 — Redact leaked credential / raw REST error bodies

- New pure `src/lib/wordpressRestError.ts` (`redactRestError(body, status,
  codeHint?)`): maps known WP codes (`rest_not_logged_in`, `rest_forbidden`,
  `rest_cannot_create/edit/delete`, `rest_post_invalid_id`, ...) and statuses
  to short safe messages; strips HTML, `Authorization`/`Basic`/`Bearer`
  fragments and app-password-like sequences; caps length; never echoes the raw
  body when a mapping exists. (The project's root-owned `redactText` can't be
  imported, so this is a minimal scoped redactor.)
- Applied at every writable WP REST error path: `siteAutomation.ts`
  publish-create, connection check, featured-image upload warn, and the
  update/delete/page/media `!res.ok` branches; `wpAdmin.ts` media-upload and
  create-post throws. Because the error is redacted at the source, the
  `result.error` interpolations in `wordpressChatCommands.ts` are already safe
  and were left unwrapped to avoid double-wrapping a friendly message.
- Smoke: new `scripts/wordpress-rest-error-smoketest.ts`
  (`smoke:wordpress-rest-error`).

## R3 — Schedule via `date_gmt` (fix wrong-hour publishing)

> Backstop add: R3 was the highest-confidence item in the research brief (0.92)
> but its wave-2 verify agent returned null, so it was silently dropped from the
> cleared set. Implemented directly afterward.

- Confirmed bug: `handleSchedule` sent `status:'future'` with
  `date: scheduleDate.toISOString()` — a Z-suffixed **UTC** instant — into the
  REST `date` field, which WordPress interprets as **site-local**, shifting the
  publish hour by the runtime-TZ↔site-TZ gap.
- New pure `src/lib/wordpressScheduleDate.ts` (`toWordPressDateGmt(date)`):
  formats the UTC instant as `YYYY-MM-DDTHH:mm:ss` (no ms, no tz suffix).
- `siteAutomation.ts`: added optional `dateGmt` to `WordPressPostRequest`; in
  `publishToWordPress`, after the (root-owned) `buildWordPressPostBody`, layer
  `postBody.date_gmt = request.dateGmt` and drop the local `date` so WordPress
  derives the local time from GMT. Root-owned `wordpressRestPayload.ts`
  untouched. `handleSchedule` now passes `dateGmt: toWordPressDateGmt(...)`.
- Smoke: new `scripts/wordpress-schedule-date-smoketest.ts`
  (`smoke:wordpress-schedule-date`, wired into `smoke:all`). typecheck clean.

## Deferred (unchanged this wave)

- R4 (context=edit/content.raw for body edits) — no current command edits the
  post body.
- R5 (CPT rest_base discovery enforcement in write path).
- R6 (raw-binary / Content-Disposition media upload + caption) — alt follow-up
  already shipped wave 1.
- R7 (pagination loop + error-vs-empty tuple) — large call-site fan-out;
  blocks the slug-collision list source.
- R17 (idempotency / double-submit) — spans bridge+edge+wpAdmin, intersects the
  proof/approval contract.
- R22 (Yoast indexables staleness/reconcile) — depends on R1 + an unbuilt
  wp-admin fallback.
- R24b (internal linking) — open-ended, content-mutating.
- KEEP AS PLANNED (high-risk / host-migration gated): R8 Browserbase host/CDP
  migration, R9 Contexts, R11 live-view, R12 uploads, R13 Stagehand, R18
  consent-overlay rules, R21 vault standardization. R10 (keepAlive/timeout) and
  R26 (cost/replay capture) not pulled — value tied to the deferred R8 host
  migration.

## Validation

- `npm run typecheck` — passes clean.
- New/affected smokes pass: `smoke:browser-verification-detectors`,
  `smoke:browser-locator-resolver`, `smoke:wordpress-seo-preview`,
  `smoke:wordpress-slug`, `smoke:wordpress-rest-error`,
  `smoke:wordpress-content-metadata`. `node --check scripts/browser-bridge.js`
  confirms the edited bridge still parses.

---

# Wave 3 — shipped 2026-06-24

Three verified, surgical items applied. All approval/proof gates and behavior
contracts preserved; no root-owned edits; new pure logic lives in
dependency-light modules with smokes wired into `package.json` + `smoke:all`.
No new approval fingerprints, tool names, or REST-first routing duplication.

## Shipped

### R22 — Yoast/RankMath staleness notice

- `src/lib/wordpressContentMetadata.ts`: new pure `buildSeoStalenessNotice(persistedCount)`.
  Returns `''` when nothing persisted (so an all-dropped write never claims a
  save); otherwise an honest line that REST wrote the meta but Yoast/RankMath
  indexables and any object/page cache may lag the live frontend until re-saved
  in wp-admin or the index rebuilds — explicitly "not confirmed live yet".
- `src/lib/wordpressChatCommands.ts` `handleAIWrite`: renders the notice as a
  string-only `>` blockquote line under the existing SEO Meta row, only when
  `seoDiff.persisted.length > 0`. Never touches the publish/return path or the
  draft creation.
- Smoke: extended `scripts/wordpress-content-metadata-smoketest.ts` (no new
  package.json entry) — 0/negative → empty; positive → mentions indexables/cache
  and contains "not confirmed live".

### R7 — Pagination + error-vs-empty tuple; real slug list

- New pure `src/lib/wordpressListPagination.ts`: `parsePaginationHeaders`
  (`X-WP-Total` / `X-WP-TotalPages`, NaN/missing/negative → 0),
  `WpListResult<T>` tuple (distinguishes HTTP/network error from a genuinely
  empty ok result), `shouldFetchNextPage(current, totalPages, cap)`, and
  `MAX_LIST_PAGES = 10` (bounded page-walk).
- `src/lib/siteAutomation.ts`: ADD-only `*Result` page-walking variants
  alongside the four legacy `[]`-returning helpers
  (`fetchWordPressCategoriesResult`, `fetchWordPressTagsResult`,
  `listWordPressPostsResult`, `listWordPressPagesResult`) via a shared
  `pageWalkWordPressList` that reuses `normalizeSiteUrl`/`wpAuthHeader`/
  `redactRestError`. Legacy helpers untouched, so existing callers are
  unaffected (adoption by `/wp list` etc. is intentionally out of scope).
- `src/lib/wordpressChatCommands.ts`: `handleDraft` and `handleAIWrite` now
  fetch the existing-slug list via `fetchExistingPostSlugs` (which uses
  `listWordPressPostsResult` with `status:'any'`, `perPage:100`) and feed it to
  `resolveUniqueSlug(slugify(title), existingSlugs)`. Fails OPEN — on
  `ok === false` or a throw it keeps `[]` so a transient read never blocks a
  draft. No change to approval/confirm gates, copy contract, or the
  `publishToWordPress` request shape (slug already forwarded).
- Smoke: new `scripts/wordpress-list-pagination-smoketest.ts`
  (`smoke:wordpress-list-pagination`, wired into `smoke:all`). The fetching
  `*Result` walkers are not smoked directly (they fetch); only the pure
  header/decision/tuple logic is.

### R19 — Enforce vault accessPolicy on REST mutations

- New pure `src/lib/wordpressVaultPolicy.ts`:
  `evaluateWpMutationPolicy({ accessPolicy, allowedActions, allowedOrigins,
  siteUrl, action })` → `{ allowed, requiresApproval, reason? }`. Acceptable-action
  map (action allowed if allowed_actions contains ANY): `publish→[publish, post]`,
  `schedule→[publish, post]`, `delete→[delete]`, `edit→[edit]`. The legacy `post`
  action satisfies publish/schedule so **existing vault rows provisioned with
  `[login, post, edit]` keep working** (creating a published post ≈ publishing a
  draft); `delete` stays strict (explicit opt-in for the most damaging op).
  Fail-closed: deny when no acceptable action is in the
  allowed-actions taxonomy, when `siteUrl` is missing/unparseable, when the
  target origin is not HTTPS, or when no allowed origin exact-matches the
  normalized target origin. `requiresApproval` is true unless
  `require_approval === false`.
- `src/lib/vaultAgentAccess.ts`: exported the previously-private
  `normalizedOrigin` (single keyword) for parity reuse.
- `src/lib/siteAutomation.ts`: added `publish` and `delete` to the default
  `allowed_actions` taxonomy for newly-stored WordPress vault credentials
  (`['login','post','edit','publish','delete']`; existing rows keep their stored
  taxonomy). `getActiveWordPressCredentials` now returns the new
  `ActiveWordPressCredentials` type and surfaces an optional `vaultPolicy`
  (`accessPolicy` + `getVaultEntryAllowedActions` + `getVaultEntryAllowedOrigins`)
  ONLY on the successful vault-reveal branch. The circle-table and user-table
  fallbacks omit `vaultPolicy`, so they stay policy-less and unchanged.
- `src/lib/wordpressChatCommands.ts`: `getCreds` passes `vaultPolicy` through;
  `handlePublish` / `handleDelete` / `handleSchedule` call a shared
  `enforceVaultMutationPolicy(creds, action)` and return a fail-closed
  "Blocked by vault policy" message (with the honest reason + Vault-dashboard
  hint) on deny. When `vaultPolicy` is absent the check is skipped silently.
  The Wave-1 dispatcher confirm gate is unchanged (handlers run post-confirm),
  so no second prompt and no new approval fingerprint were added. Schedule's
  check sits after future-date validation but before the AI content generation.
- Smoke: new `scripts/wordpress-vault-policy-smoketest.ts`
  (`smoke:wordpress-vault-policy`, wired into `smoke:all`) — deny on
  missing-action/HTTP/origin-mismatch/missing-or-invalid-siteUrl,
  allow on HTTPS+action (case-insensitive origin), schedule-requires-publish,
  and the requiresApproval default/override.

## Deferred (researched, not built this wave)

- **R4** (context=edit / content.raw for body edits) — DROPPED: no current
  command edits the post body, so there is nothing to make raw-safe yet.
- **R5** (CPT `rest_base` discovery before posting + show_in_rest fail-over to
  wp-admin) — PLANNED: `wpAdmin.ts discoverPostTypes` exists but is uncalled and
  `uploadImageAndCreateSlide` hardcodes `flavor_di_slides`; the fail-over path
  touches the browser/admin executor and warrants its own clearing.
- **R6** (raw-binary + explicit Content-Disposition media upload + caption
  follow-up) — PLANNED: `alt_text` follow-up already shipped Wave 1; the
  binary/disposition rework spans `siteAutomation.uploadWordPressMedia` and
  `wpAdmin.uploadMedia` and needs its own pass.
- **R17** (idempotency / double-submit) — PLANNED: cross-cutting across
  bridge + edge + wpAdmin and intersects the proof/approval contract; no
  clearly-isolated low-risk slice this wave.
- KEEP AS PLANNED (research-only this wave): **R8** Browserbase host/CDP
  migration, **R9** Contexts, **R10** keepAlive/timeout, **R11** live-view
  `/debug`, **R12** uploads, **R13** Stagehand executor, **R18** consent
  overlays, **R21** vault standardization, **R24b** internal linking, **R26**
  cost/replay. See the migration plan below.

## Validation

- `npm run typecheck` — passes clean.
- New/affected smokes pass: `smoke:wordpress-content-metadata`,
  `smoke:wordpress-list-pagination`, `smoke:wordpress-vault-policy`,
  `smoke:wp-command-risk`.

## R8 / Stagehand migration plan (research only — no code this wave)

Read-only research confirmed against current Browserbase docs + the
authoritative `browserbase/sdk-node` source and the installed
`@browserbasehq/stagehand` 3.3.0 (pin `^3.2.1`). Two honest gaps are flagged.

### Confirmed Browserbase facts

- **Host**: the documented session-create host is `api.browserbase.com`
  (`POST /v1/sessions`, header `X-BB-API-Key`), returning a `201` whose
  connection fields include `connectUrl` (a WebSocket/CDP URL). The current code
  POSTs to the undocumented `www.browserbase.com/v1/sessions`
  (`computer-use-agent/index.ts:1340`) and never consumes `connectUrl`.
- **`/commands` bridge — NEEDS LIVE ACCOUNT**: no `/v1/sessions/{id}/commands`
  endpoint exists in docs or the SDK (which exposes only create/retrieve/update/
  list/debug). The code's `bbCommand` POST (`index.ts:1426`) is an undocumented
  bridge. SDK absence is strong but docs-absence does not prove the live account
  404s it — verify before removing the fallback.
- **Contexts**: real. `contexts.create({ projectId })` → id; reuse via
  `sessions.create({ browserSettings: { context: { id, persist: true } } })`.
  Caveats: wait a few seconds after a persist session closes before reuse;
  contexts invalidate on deletion / cookie expiry.
- **Live view**: `GET /v1/sessions/{id}/debug` returns
  `debuggerFullscreenUrl` / `debuggerUrl` / `wsUrl` / `pages[]` — the real
  human-takeover URL. The code hand-builds a non-takeover
  `www.browserbase.com/sessions/{id}` (`index.ts:504,1358`).
- **keepAlive + timeout**: both are create-time params (`timeout` 60–21600s);
  explicit release is `POST /v1/sessions/{id}` `{status:'REQUEST_RELEASE'}`.
  The code passes neither and never releases.
- **Uploads**: `POST /v1/sessions/{id}/uploads` (multipart `file`) →
  `/tmp/.uploads/{name}`, attached via CDP `DOM.setFileInputFiles`. Both upload
  paths require a live CDP channel.

### Load-bearing risk (UNCONFIRMED)

The documented CDP path uses `playwright-core` / `chromium.connectOverCDP`,
which is a Node binary dependency that does NOT run in the Supabase Deno edge
function (`Deno.serve`, `index.ts:265`). Migrating to `connectUrl` means either
(a) hand-rolling raw CDP over a Deno `WebSocket`, or (b) carving the
browser-driving half out to a Node host/worker. This is the single biggest
decision and the reason the undocumented `/commands` bridge exists. It must be
settled against the live account + chosen runtime before any code.

### Recommended sequence (behind a per-circle transport flag; default keeps the existing path)

1. **R8.0** — Live-account probe (no app code): confirm `connectUrl` is
   returned; check whether the `/commands` bridge still works or 404s; smoke a
   Deno `WebSocket(connectUrl)` + one CDP round-trip. Go/no-go on edge-CDP vs.
   needing a Node host.
2. **R8.1** — Feature flag + transport seam: extract a `BrowserbaseTransport`
   interface (open/screenshot/click/type/key/scroll/release) so `/commands` and
   CDP are interchangeable. Pure URL/param + action-name mapping goes in a new
   dependency-light `src/lib/browserbaseTransport.ts` (import-type only) with a
   smoke in `smoke:all`. Switch the host to `api.browserbase.com` ONLY on the
   `cdp` branch; the `commands` branch stays byte-for-byte on `www.`.
3. **R10** — keepAlive/timeout at create + explicit `REQUEST_RELEASE` in the
   finally block; honor 429 retry-after. Low-risk, host-independent — ships on
   either branch first to trim zombie-session cost.
4. **R11** — real live-view via `debug()` (a plain REST GET, host-independent of
   transport) wired into the existing `human_takeover` flow.
5. **R8.2** — CDP transport (edge-CDP if R8.0 passed, else Node-host carve-out),
   driving `Page.captureScreenshot` / `Input.dispatch*` / `Runtime.evaluate`,
   honoring the 5-minute connect window. SSE protocol, token/cost gates,
   `ask_user`, `fill_saved_login`, and screenshot pruning untouched.
6. **R9** — Contexts (`browserSettings.context={id,persist}`) once create runs
   on `api.browserbase.com`; per-circle/per-site context-id store. Does NOT
   bypass the `fill_saved_login` approval/origin gates.
7. **R12** — browser file-upload action (Uploads API + CDP `setFileInputFiles`),
   strictly after R8.2, behind its own explicit approval gate.

### R13 Stagehand (depends on R8)

Correction to the prior brief: Stagehand is NOT an unwired zero-import seam.
`scripts/stagehand-runner.mjs` already imports `@browserbasehq/stagehand` and is
already wired into `src/lib/computerUse.ts` (`STAGEHAND_RUNNER` at :205, via
`callStagehandRunner` / `ensureStagehandSession` / `runStagehandSessionCommand`
over the local bridge `/exec`). So R13 is FIX-AND-HARDEN, not greenfield.

- v3 `act()` / `observe()` / `extract()` are INSTANCE-level (not on `page`);
  `observe()` returns `Action[]` to feed into `act()`; `extract(instruction,
  ZodSchema)` returns typed data. A hosted Stagehand REST API exists
  (`api.stagehand.browserbase.com` via `POST /sessions/start` with
  `x-bb-api-key` + `x-model-api-key`; default `disableAPI:false`). v3 can attach
  to an existing Browserbase `connectUrl` via `env:'LOCAL'` +
  `localBrowserLaunchOptions.cdpUrl` — the concrete R8 linkage.
- Concrete runner bugs that block real semantic calls today: (1) NO model in the
  config (defaults to `openai/gpt-4.1-mini`, needs an LLM key or the hosted
  `x-model-api-key`, else it "continues without LLM client" and calls throw);
  (2) a dead page-level `observe`/`extract` fallback that masks errors with
  stale page text; (3) `page.url()` treated as async though v3's is sync.
- The `#1767` server-cache caveat is real but PERFORMANCE-ONLY (closed issue,
  DOM-hash-fragile, BROWSERBASE-only): correctness must come from the
  proof-after evidence gate, never from cache. Keep approval/verification gates,
  no `waitForCaptchaSolves`, no auto-CAPTCHA. Pure action-mapping/Zod-bridge
  logic goes in a new import-type-only module with a smoke. Hard dependency on
  R8 — `computerUse.ts:670,694` mint the same wrong `www.browserbase.com` live
  URL R8 must migrate; do not ship R13 standalone.

---

## Wave 4 — shipped 2026-06-24

Two low-risk WordPress REST items landed this wave (R5 discovery/classify, R6
robust media upload). Both ship a pure dependency-light module + standalone
smoke wired into `smoke:all`; the R6 helpers are additionally adopted in the two
writable upload paths behind a multipart fallback so there is no upload
regression when the mime type is indeterminate.

### WP2 — CPT `rest_base` resolver + REST-publishability classifier (R5, pure)
- New `src/lib/wordpressPostTypeResolver.ts` (import-type only, no `fetch`):
  - `resolveRestBase(types, requestedSlug)` → `{ restBase, matchedSlug, source }`.
    Match priority: exact key, then `.slug` match; falls back to the requested
    slug when not found or when a matched entry has no `rest_base`. Never throws
    (null/empty map handled).
  - `classifyPostTypeWritability(entry)` → `{ restPublishable, reason,
    needsAdminFallback }`. Flags missing entry, `show_in_rest === false`, or a
    missing `rest_base` as needing the wp-admin browser fail-over.
    `show_in_rest === undefined` does NOT force fallback (older cores omit it).
- New `scripts/wordpress-post-type-resolver-smoketest.ts`
  (`npm run smoke:wordpress-post-type-resolver`): exact match, `rest_base != slug`
  (`flavor_di_slides` → `di-slides`), missing type, empty/null map, `show_in_rest:false`,
  missing `rest_base`, older-core `show_in_rest:undefined`.
- Caller wiring (`uploadImageAndCreateSlide`'s hardcoded `flavor_di_slides`) and
  the actual wp-admin browser fail-over EXECUTOR are intentionally NOT in this
  wave — see roadmap `R5-admin-fallover` (medium risk, crosses the admin/browser
  executor boundary; `show_in_rest` is not reliably exposed by `/types`, so
  detection must be hardened by probing the `rest_base` before fail-over is
  trusted).

### WP1/WP3 — robust raw-binary media upload + caption follow-up (R6)
- New `src/lib/wordpressMediaUpload.ts` (import-type only, no `fetch`, never
  builds an Authorization value — caller passes a pre-resolved one):
  - `sanitizeMediaFilename(name)` — strips CRLF/quotes/control chars, reduces to
    basename, falls back to `'upload'`.
  - `resolveUploadMimeType(blobType, fileName)` — prefers a valid `type/subtype`
    blob type, else maps the extension; returns `null` when indeterminate so the
    caller keeps multipart.
  - `buildMediaUploadHeaders({ authorization, mimeType, filename })` — raw-binary
    `Content-Type` + `Content-Disposition: attachment; filename="..."`.
  - `buildCaptionFollowUpBody(caption)` — `{ caption }` for a non-empty trimmed
    string, else `null` (mirrors the alt_text gating).
- New `scripts/wordpress-media-upload-smoketest.ts`
  (`npm run smoke:wordpress-media-upload`): filename sanitization (CRLF/quotes/
  traversal/empty), mime resolution (blob passthrough, extension map, unknown →
  null), disposition format (exactly two quotes, no CRLF leak), caption gating.
- Adopted in BOTH writable upload paths:
  - `src/lib/wpAdmin.ts` `uploadMedia` (`mimeType` now optional) — raw-binary
    when a mime resolves, else the existing multipart `FormData` path unchanged;
    a single combined `alt_text` + `caption` follow-up POST (non-fatal).
  - `src/lib/siteAutomation.ts` `uploadWordPressMedia` (+ optional `caption`
    param) — same raw-binary-with-multipart-fallback shape; single combined
    follow-up POST; `{ success, mediaId?, url?, error? }` result shape preserved.
- Out of scope (roadmap `R6-featured-image-path`, low risk): the inline
  `publishToWordPress` featured-image upload (`siteAutomation.ts` ~1149-1158)
  still uses multipart with no Content-Disposition; fold it in once WP3 is
  verified in production.

No approval fingerprints, tool names, or behavior contracts changed; both upload
result shapes preserved; the multipart fallback guarantees no upload regression
when the mime is indeterminate. `npm run typecheck` passes.

## Wave 5 — shipped 2026-06-29

Wave 5 wired the already-shipped pure helpers from the prior waves into their
runtime call sites and added the R8 enablement gate. No new app runtime path was
introduced by the probe; no v2 default flipped; no approval fingerprints, tool
names, or behavior contracts changed.

### R5 caller wiring — CPT REST-base resolution (fail-closed)
- `src/lib/wpAdmin.ts` now resolves the real `rest_base` before any CPT write:
  `resolvePostTypeRestBase` (`wpAdmin.ts:123-155`) calls the (previously
  uncalled) `discoverPostTypes` → `resolveRestBase` to pick the discovered
  `rest_base`, then `classifyPostTypeWritability` to gate it.
- Wired into `createPost` (`wpAdmin.ts:275`), `updatePost` (`:310`),
  `trashPost` (`:357`), and `listPosts` (`:402`) via `requireRestWritable: true`.
- `uploadImageAndCreateSlide` (`wpAdmin.ts:418-438`) no longer hardcodes
  `flavor_di_slides`; it derives the slide CPT through `resolveDefaultSlidePostType`
  and routes through `createPost`, so it inherits the same resolution + gate.
- Behavior on a clean `rest_no_route`/404/`show_in_rest=false` signal: **fail
  closed** — `resolvePostTypeRestBase` throws a structured Error
  (`wpAdmin.ts:149-151`) pointing at the wp-admin browser fallback. This
  supersedes the doc's earlier "next wave / returned-marker" framing
  (the `needsAdminFallback` marker is still emitted by the pure
  `classifyPostTypeWritability`; the call site consumes it as a fail-closed
  throw rather than a silent returned marker, preserving the
  create/update/trash/list contracts). The wp-admin browser executor itself
  stays **planned, not built**.
- When `/types` discovery is transiently unavailable, the slug is validated and
  passed through unchanged (`wpAdmin.ts:134-141`) so existing CPT behavior is
  preserved — no new failure mode.

### R6 featured-image path — folded into `publishToWordPress`
- `src/lib/siteAutomation.ts` `publishToWordPress` (`siteAutomation.ts:1154-1176`)
  now uses the SAME raw-binary path as `uploadWordPressMedia` /
  `wpAdmin.uploadMedia`: `resolveUploadMimeType` → `buildMediaUploadHeaders`
  (`Content-Type` + `Content-Disposition`) when the mime resolves, else the
  existing multipart `FormData` fallback. Non-fatal on failure; the
  `{ success, postId?, postUrl?, returnedMeta? }` result shape is unchanged.
  This closes the "out of scope" item noted in the WP1/WP3 (R6) section above.

### R8.0 — Browserbase live-probe (enablement only)
- New `scripts/browserbase-live-probe.mjs` (Node ≥18, `npm run probe:browserbase`):
  reads `BROWSERBASE_API_KEY` + `BROWSERBASE_PROJECT_ID` from env only (never
  argv), masks/redacts secrets in all output, isolates each probe, always
  releases any session it creates, best-effort deletes any context, and prints a
  PASS/FAIL summary mapping to the R8.0 go/no-go (GO IFF Q0 `connectUrl` PASS AND
  Q1 `debug` PASS). Q2 probes the legacy `www.browserbase.com/.../commands`
  endpoint (body shape mirrors `computer-use-agent/index.ts:1432`) without
  depending on it. Exit codes: `0` GO, `1` NO-GO/FAIL, `2` env missing.
- The R8 gate procedure is documented in
  `docs/WORDPRESS_BROWSER_AUTOMATION_RESEARCH_2026-06-23.md` ("How to run R8.0").
- The CDP migration itself (R8.x), Contexts (R9), live `/debug` view (R11), and
  CDP file-upload (R12) remain **out of scope / deferred** behind a GO result.

Validation: `npm run typecheck` passes; `npm run smoke:wordpress-media-upload`
and `npm run smoke:wordpress-post-type-resolver` pass (both already in
`smoke:all`); `node --check scripts/browserbase-live-probe.mjs` clean.
