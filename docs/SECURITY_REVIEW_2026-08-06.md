# Application Security Review — 2026-08-06

**Review cutoff:** 2026-08-06

**Production app:** `https://app.chrisswanson.xyz`

**Production Supabase project:** reviewed through authenticated CLI/catalog
queries and bounded unauthenticated canaries

**Purpose:** record the security incident, the live remediation evidence, and
the remaining release work without storing any credential, token, invite code,
or secret value.

This is a dated evidence snapshot, not a claim that the application has no
attack surface. A web client necessarily publishes its Supabase project URL
and publishable/anonymous key. Those identifiers must remain safe to expose
because authorization is enforced by Row Level Security (RLS), authenticated
RPCs, Edge Function checks, storage policy, and server-held provider keys.

## Executive result

Several serious production authorization issues were found and closed during
this review:

- a database credential-encryption key helper had been callable by anonymous
  users; its execute grants were removed and the key was treated as
  compromised. The two site-credential rows were atomically re-encrypted under
  a new key without printing either key or plaintext. A later consumer audit
  found that seven pre-existing `user_api_keys` rows shared that key but were
  omitted from the rotation and are no longer decryptable; those ciphertexts
  remain preserved pending old-key recovery or owner re-entry;
- legacy collaboration and circle policies allowed anonymous reads wider than
  the product intended; the policies and table grants were replaced with
  membership/ownership boundaries, public discovery moved to safe RPC
  projections, and 13 exposed views now use invoker security;
- the complete live `public`-schema `SECURITY DEFINER` catalog was changed to
  default deny: all 104 functions are service-role callable, zero are
  executable by `PUBLIC` or `anon`, and exactly 55 audited functions are
  callable by `authenticated` with no extra signatures;
- browser access to Google and GitHub OAuth token tables was removed; circle
  integration secrets were migrated to versioned AES-256 ciphertext behind
  authenticated manager RPCs, and the plaintext/browser-read path was removed;
- profile deletion, flexible circle creation, creator membership, and default
  Chat-thread creation were aligned with the live schema and verified with no
  missing creator memberships or default threads;
- public Edge Functions reviewed in this pass now authenticate the caller or
  validate their dedicated callback/webhook authority before privileged work;
- the live and reviewed local browser bundles contained no usable provider
  key, service-role key, private key, or bearer credential. A prebuild gate now
  rejects configured provider/service credentials under `EXPO_PUBLIC_*`;
- the complete `npm run check:security:release` gate passed, including focused
  security smokes, both application and Edge Function typechecks, the Expo web
  export, public-bundle secret scanning, dependency-tree checks, and the
  production dependency audit;
- isolated authenticated local and production-browser tests each created a
  temporary hosted Auth user and circle, opened Chat, sent `/help`, observed
  the OpenSwan command catalog, found zero lazy-module failures, and cleaned up
  their temporary data.

These repairs materially improve the live backend. They do **not** justify the
statement “there are no APIs anyone can use.” Login, signup, OAuth callbacks,
public discovery, and webhook endpoints are intentionally reachable; their
safety depends on their scoped authorization contracts. The gated frontend was
deployed to Netlify as `6a752a514ea89752b1464f77`; production and
unique-deploy HTML hashes matched the local export, the root/Auth/Main/Circle/
Chat graph used the expected fresh URLs, the checked JavaScript hashes matched,
and the live security/cache headers were verified. Live mailbox and
third-party OAuth provider completion were not exercised.

## Evidence labels

- **Live verified** means a production catalog query, hosted configuration
  read, function deployment check, or bounded unauthenticated canary was run.
- **Source verified** means static assertions, typechecks, dependency audit,
  or a local web export passed; it is not evidence that the live site serves
  that code.
- **Not exercised** means the flow requires a real user mailbox, third-party
  identity provider, second browser/client, or a device-bound local bridge and
  was deliberately not simulated with production user data.

## Live production findings and remediation

### 1. Privileged database functions and credential encryption

The most severe issue was an anonymous execute path to
`site_credential_encryption_key()`. Because a caller could obtain the live key,
the key was considered compromised even though no stored plaintext credential
was printed during the review.

Live remediation and proof:

- `PUBLIC` and `anon` execute were revoked catalog-wide from every
  `public`-schema `SECURITY DEFINER` function; `service_role` retains the
  privileged surface;
- the audited authenticated allowlist contains 55 functions, with zero extra
  authenticated signatures and one expected claimant-bound `invoke_agent`
  signature absent because that safe Office migration is not installed;
- the dead `bump_memory_access` function was removed, database lint reports
  zero errors, and fixed search paths cleared 36 warnings;
- the final live catalog contains 104 `SECURITY DEFINER` functions: 104 are
  executable by `service_role`, 55 by `authenticated`, and zero by either
  `PUBLIC` or `anon`;
- a one-time transactional rotation locked the credential table, decrypted and
  re-encrypted both existing rows, changed the vault key, and verified both
  rows are decryptable under the new key/version. No key or plaintext appeared
  in output.

Relevant source contracts:

- `supabase/migrations/20260806174000_rotate_site_credential_encryption_key.sql`
- `supabase/migrations/20260806174500_security_definer_emergency_lockdown.sql`
- `scripts/site-credential-key-rotation-security-smoketest.ts`
- `scripts/security-definer-emergency-lockdown-smoketest.ts`

Follow-up consumer audit:

- the rotation source originally inventoried only
  `circle_site_credentials`, while `user_api_keys.api_key_enc` also resolved
  the same Vault `ENCRYPTION_KEY` through `app_encryption_key()`;
- a value-free production probe found seven affected `user_api_keys` rows and
  confirmed that current-key decryption fails. No key, plaintext, ciphertext,
  or provider-token value was returned;
- the source rotation now locks and transactionally rewraps `user_api_keys`
  when its effective app key is the Vault key being rotated, verifies every
  replacement row, and leaves a separately configured app-key domain intact;
- the `llm-proxy` Edge provider lookup now preserves
  `credential_unreadable` separately from `key_missing`. Owner/test platform
  fallback remains available before that failure is surfaced; ordinary users
  are directed to revoke/re-enter an API key or reconnect OAuth rather than
  launch a coding-repair agent. Other Edge callers retain their legacy
  missing-key behavior until they adopt the opt-in structured contract;
- this source correction cannot reconstruct already unreadable ciphertext.
  Recovery requires the prior key from a controlled backup/PITR environment or
  credential re-entry. The trading wallet row must not be deleted or
  overwritten because a missing independent private-key backup may make its
  signing authority unrecoverable.

The catalog is now fail-closed for legacy client RPCs that were not explicitly
audited. That intentionally disables older direct XP/award/stream/Office paths
instead of preserving unsafe compatibility. The safe claimant-bound Office
`invoke_agent` migration remains required before that function is restored to
authenticated clients.

### 2. Collaboration, circles, views, and storage

Live RLS/grant hardening closed anonymous access to the collaboration tables
reviewed here, including profiles, check-ins, pins, tasks, reactions, votes,
XP events, and achievements. Authenticated access is now membership-, owner-,
or target-bound, and broad authenticated `TRUNCATE`/table privileges were
removed.

Circle discovery no longer returns raw circle rows. `circles.is_public`
defaults to false; safe discovery/join RPCs project only intended fields and
enforce membership, capacity, expiration, invite, and email constraints. Raw
circle reads require creator or membership. All SELECT-only legacy
`circle_invites` policies were removed while the scoped management policy was
preserved. Thirteen public views were changed to `security_invoker=true`.

During the review, one legacy circle was found in the formerly exposed state
with non-null invite/API credential fields. Their values were not read. Both
were rotated, which invalidates old invite links and any integration configured
with the old circle credential.

An initial unauthenticated GET to `aggregate-analytics` returned success before
the boundary was fixed. That probe caused one analytics recomputation/upsert.
The endpoint was then redeployed behind authentication and subsequent
unauthenticated canaries failed closed. This was the only known review-induced
production write.

Relevant source contracts:

- `supabase/migrations/20260806_public_collaboration_rls_hardening.sql`
- `supabase/migrations/20260806172000_circle_public_access_emergency_hardening.sql`
- `supabase/migrations/20260806191000_profiles_auth_user_delete_cascade.sql`
- `supabase/migrations/20260806193000_circles_flexible_schema_alignment.sql`
- `supabase/migrations/20260806193500_circle_creator_membership_alignment.sql`
- `supabase/migrations/20260806194000_circle_default_chat_thread_bootstrap.sql`
- `scripts/public-collaboration-rls-security-smoketest.ts`
- `scripts/circle-public-access-emergency-security-smoketest.ts`
- `scripts/circle-client-safe-rpc-smoketest.ts`

The live schema was also reconciled with the circle-creation and Chat clients:

- the flexible circle fields written by the app now exist with bounded
  constraints and indexes;
- circle creation atomically creates the canonical `creator` membership and a
  default `Circle Chat` thread, and existing gaps were backfilled;
- a final live invariant query found zero circles missing creator membership
  and zero circles missing a default thread;
- the redundant client-side creator-membership insert was removed, eliminating
  a race and a role mismatch that previously rejected `owner`;
- `profiles.id -> auth.users.id` now uses `ON DELETE CASCADE`, and the migration
  plus source smoke passed.

The profile cascade does not make every populated account universally
deletable. The catalog still contains 30 other direct `auth.users` foreign keys
using `NO ACTION` and nine profile-child `NO ACTION` foreign keys. Any populated
dependent row can still block deletion until those relationships receive an
explicit retention/deletion policy.

Residual storage risk: the task-image bucket remains public because the current
client uses public URLs. Object write/delete policies are hardened, but anyone
who obtains a public object URL can read that image. Moving to a private bucket
with short-lived signed URLs is still required for private task images.

### 3. Edge Functions and server-held provider credentials

Authentication, circle membership, object ownership, request bounds, SSRF
controls, callback state, and sanitized error handling were tightened across
the reviewed live functions, including SwanBot, LLM proxy, room task execution,
computer use, chat/build streaming, OAuth, research/heartbeat/boss agents,
analytics, GitHub OAuth, and view-build. Bounded unauthenticated canaries for
privileged function actions now reject the request.

`verify_jwt=false` is not by itself a public authorization decision. It is
required for OAuth callbacks and some current ES256 gateway compatibility
paths; each such function must perform its own `auth.getUser()` check for app
actions and validate single-use OAuth state or webhook signatures for callback
actions. A function may not rely on CORS as authentication.

The production and reviewed local bundles were scanned without finding a usable
provider/service credential. `EXPO_PUBLIC_SUPABASE_ANON_KEY` is intentionally
publishable and is not a server secret. The prebuild check in
`scripts/public-env-security-check.mjs` rejects non-empty provider keys,
service-role keys, private keys, client secrets, passwords, and access/refresh
tokens in the public Expo environment. Provider calls must use authenticated
Edge Functions or user-scoped BYOK storage.

The live token and integration-secret boundaries were further tightened:

- `supabase/migrations/20260806190000_oauth_token_browser_boundary.sql`
  removed browser table policies and direct anonymous/authenticated grants from
  `user_google_credentials` and `user_github_tokens`; only `service_role` can
  read the raw rows, and unauthenticated REST canaries returned 401;
- browser callers now use bounded Edge Function status/action contracts rather
  than reading Google tokens; direct GitHub OAuth token mutations fail closed
  until a server-side proxy owns them;
- `supabase/migrations/20260806192000_circle_integration_secret_rpc_hardening.sql`
  moved circle integration secrets behind authenticated manager RPCs and a
  private AES-256 pgcrypto envelope. All eight live values were migrated to
  versioned, decryptable ciphertext without printing plaintext or keys;
- authenticated browser reads expose neither plaintext nor ciphertext, service
  compatibility reads remain available, anonymous secret writes fail closed,
  and the focused integration-secret smoke passed 95 assertions;
- a linked-database lint caught an invalid schema qualification on the SQL
  `COALESCE` expression in the reveal RPC. The baseline was corrected,
  `20260806194500_circle_integration_secret_reveal_sql_fix.sql` was applied
  live, and a fresh linked `public`-schema error-level lint returned zero
  findings.

Three high-value functions were deployed live after their security smokes and
Edge Function typechecks passed:

- `automation-executor` now authenticates and authorizes the caller, charges
  caller-scoped BYOK, bounds untrusted events, prevents event/service-triggered
  mutations, and restricts outbound Slack, Discord, and Telegram webhooks to an
  exact no-redirect allowlist;
- `github-webhook` now streams with a 2 MiB cap, validates WebCrypto HMAC with a
  minimum 16-character connection secret, returns uniform authorization
  failures, bounds parsed payloads, and makes signed ping explicit;
- `swanbot-ai` no longer offers hosted arbitrary URL fetch or arbitrary
  custom/self-hosted endpoint egress, uses fixed provider hosts with bounds and
  no redirects, and scopes task updates to the exact circle.

Post-deploy unauthenticated canaries returned 401 for `automation-executor`,
`swanbot-ai`, and a syntactically valid but unauthorized signed GitHub webhook.
An invalid repository identity is rejected as input validation before lookup,
which is expected and is not authorization proof.

These deliberately fail-closed changes have compatibility consequences:
arbitrary saved webhook destinations no longer execute; hosted custom/local
model endpoints must use the local bridge; GitHub webhook secrets shorter than
16 characters must be rotated; and signed ping requires a configured
connection and secret.

Residual Edge Function risks still requiring work:

- `agent-connect` uses plaintext, non-expiring connection tokens and still
  needs tighter payload bounds and rate limits;
- `chat-stream` still needs explicit input/token bounds and upstream timeouts;
- GitHub OAuth state consumption is not atomic, circle membership is not yet
  checked at authorization, and requested scopes remain broad;
- Google OAuth state consumption is not atomic; raw provider-token tables are
  service-only but the stored provider tokens are not yet application-encrypted;
- the public `view-build` preview can still be abused for content hosting or
  phishing and needs a stronger publication/abuse boundary;
- the live computer-use confirmation table is absent, so the feature currently
  fails closed. The old migration must not be applied unchanged because it
  would allow circle members to resolve confirmations created by other users.

## Authentication and login review

### Live hosted Auth configuration

The hosted configuration was read directly and verified as follows:

- site URL: `https://app.chrisswanson.xyz`;
- redirect allowlist: the production app wildcard plus the explicit localhost
  `8081` development callbacks;
- minimum password length: 8;
- required password groups: lowercase, uppercase, and digits;
- breached-password/HIBP checking: enabled;
- recent reauthentication for password update: enabled;
- anonymous sign-in: disabled;
- email auto-confirm: enabled;
- custom SMTP: not configured;
- CAPTCHA: not configured;
- built-in email rate limit: 2 per hour.

The checked-in `supabase/config.toml` is a local-development configuration and
does not mirror these hosted URL values. Do not treat it as production proof or
push it over hosted Auth settings without an explicit configuration review.

A live deliberately weak signup probe returned HTTP 422 with the expected
weak-password reasons (length, character classes, and breached-password
screening) and did not create a user.

A separate bounded hosted-Auth exercise created a temporary user, validated
the returned session with `getUser()`, logged out, signed in again, logged out
again, and confirmed refresh-token replay was rejected. The temporary user and
profile were removed and the cleanup invariant returned zero matching rows.
This verifies the exercised API session lifecycle; it does not verify mailbox
delivery, email confirmation, or a third-party OAuth provider.

Email auto-confirm is a product/security choice, not a completed control. It
reduces friction but allows accounts without proving mailbox ownership. Before
broad public signup, decide whether to require email confirmation, configure a
production SMTP provider and branded templates, and enable Turnstile or
hCaptcha. Confirm reset/signup email delivery, expiry, replay rejection, and
rate-limit UX with a dedicated test account.

### Frontend source hardening

The reviewed source now:

- validates a persisted session with a fresh server `getUser()` check before
  rendering the authenticated navigator or starting agent/bridge work;
- supports forgot-password, recovery-only routing, password update, and return
  to login without exposing whether an account exists;
- enforces matching client password requirements and bounded input lengths;
- prevents stale async auth responses from winning navigation races and adds
  accessible labels, autocomplete hints, and focus states;
- centralizes sign-out and clears local agent, bridge, file-grant, task,
  recording, capability, and navigation authority; native auth storage uses
  chunked SecureStore with a fail-closed AsyncStorage migration;
- uses an app-origin OAuth callback relay with exact path, provider, nonce,
  opener, and origin checks. OAuth result data travels in the URL fragment,
  is cleared before normal app mounting, and is relayed only to the exact app
  origin.

These frontend changes were deployed to the production site as Netlify deploy
`6a752a514ea89752b1464f77`. The production and immutable deploy URLs returned
the same `index.html` SHA-256 as the gated local export, and the live Chat chunk
also matched its local exported hash. The live CSP restricts Supabase
connectivity to the exact production project, removes direct browser
connectivity to OpenAI, Anthropic, and Google AI, and retains only the required
local bridge and public data/chain endpoints. The root, login, signup,
forgot-password, reset-password, and OAuth callback routes returned HTTP 200.

## Authenticated Chat and local development runtime

Isolated browser tests against both the local release candidate and the live
production deployment used temporary hosted Auth users and circles, injected
only each temporary user session into the isolated browser, entered Chat, sent
`/help`, and observed the OpenSwan command catalog. The production composer
exposed an accessible `Send message` control, no Chat lazy-module load failures
occurred, and the script removed the temporary circle, profile, and Auth user
in `finally`. A post-run production query found zero temporary users and zero
temporary circles matching the canary prefixes.

The exact reported regression was also replayed against production with a
temporary signed-in circle whose Web Search toggle was ON. Sending `hello`
produced and persisted a non-empty `main_chat_openswan` reply, made zero
`openrouter:web_search` requests, and rendered no Web Search failure, failed
receipt, or connected-agent repair card. The canary again removed its
temporary user and circle in `finally`.

That replay also exposed a deployment-cache hazard in the long-lived isolated
browser: before its cache was disabled, an older Metro entry graph loaded stale
Login and Circle chunks and raised `recordWorkspaceTabVisit is not a function`.
The current exported module itself did contain that function; a fresh load
used the current chunks and passed. Netlify had marked every JavaScript file
`max-age=31536000, immutable`, even though Metro can keep an entry filename
stable while changing the dynamic-import path table embedded in it. Production
JavaScript now uses `max-age=0, must-revalidate`, the non-critical workspace
visit counter is defensively guarded, and the Netlify security smoke rejects
immutable JavaScript caching. Images and other content-addressed assets retain
long-lived immutable caching.

The Chat send boundary now catches failures from the complete send pipeline,
including early lazy imports, releases pending locks/UI state, reports a
recoverable local error, and does not launch or foreground the browser during
recovery. This prevents a module-resolution failure from becoming an unhandled
promise that leaves Chat apparently unresponsive.

The original lazy-bundle 500 errors were traced to a stale Metro process after
the dependency tree changed. The development supervisor now fingerprints the
package locks and Expo/Metro resolver metadata and restarts only Expo with a
cleared cache after a bounded quiet period/cooldown, leaving the agent bridges
running. Both initial Expo start and dependency restarts set `BROWSER=none`,
which prevents Expo's `--web` mode from opening or foregrounding Chrome. This
guard is active only when development is started through
`npm run start`; a standalone `npm run web`/direct Expo process remains outside
the supervisor and must be restarted manually after dependency changes.

## Local desktop bridge boundary

The desktop/agent bridges are loopback services with pairing/token checks, but
pairing is not yet a durable device-bound attestation. Browser foreground
changes, a shared local user session, or leakage of a loopback token could
cross the intended trust boundary. Keep mutation tools fail-closed when a pair,
process/window target, exact user grant, or fresh observation is missing. Do
not make a successful health probe equivalent to authorization. A future
release should bind bridge authority to the authenticated app user, device,
bridge process instance, task/action identity, and short-lived one-use grant.

## Dependency snapshot

At the review cutoff:

- `npm audit --omit=dev` reported 13 moderate production advisories, zero high,
  and zero critical;
- the full dependency tree reported one high advisory in `undici@5.29.0`,
  pulled through the development-only Stagehand/AI SDK tree;
- the production Expo CLI path resolves `undici@6.28.0`, while Stagehand is a
  dev dependency and is not included by `--omit=dev`.

This is not a permanent exception. Re-run both audits for every release, keep
Stagehand out of the browser bundle/runtime, and upgrade the transitive AI SDK
line when its upstream constraints permit a non-breaking fix. Do not use a
forced dependency downgrade that breaks the browser automation toolchain.

## Security release gate

The complete `npm run check:security:release` command passed after the changes
recorded here. Its evidence includes the public-environment check; auth session,
security, and logout smokes; OAuth browser-token boundaries; profile/circle
schema and membership/thread alignment; Chat send failure containment; Metro
dependency restart guard; CSP assertions; collaboration/RLS/RPC/integration-
secret and `SECURITY DEFINER` contracts; SwanBot, automation, webhook, task,
storage, build, and desktop security smokes; all application and Edge Function
typechecks; a successful Expo web export; the exact exported-bundle credential
scan; dependency-tree validation; and `npm audit --omit=dev --audit-level=high`.

Passing this gate proves the checked-out source/export satisfied those tests.
Netlify artifact and header identity were verified separately after deployment;
the gate still does not replace any of the mailbox, provider OAuth, bridge, or
two-client tests listed below.

## Remaining release blockers and follow-ups

1. Complete the remaining production browser scenarios that require a real
   mailbox or provider: logout, reset email, recovery deep link, OAuth popup
   completion, refresh, and back-button behavior. Route reachability and the
   authenticated Chat path are verified, but these flows were not all driven
   to completion.
2. Configure CAPTCHA and production SMTP; make an explicit email-confirmation
   decision and exercise the real mailbox flows with a dedicated test user.
3. Resolve the remaining Edge Function boundaries: expiring/hashed
   `agent-connect` tokens and request limits; `chat-stream` bounds/timeouts;
   atomic OAuth-state consumption and narrower GitHub authorization/scopes;
   provider-token application encryption; `view-build` abuse controls; and a
   user-bound computer-use confirmation schema.
4. Make task-image storage private and replace public URLs with bounded signed
   URLs before storing sensitive images.
5. Ship and verify the claimant-bound Office `invoke_agent` migration before
   restoring authenticated Office execution. Do not regrant the legacy RPC.
6. Define retention/deletion behavior for the 30 direct `auth.users` and nine
   profile-child `NO ACTION` foreign keys, then test deletion with populated
   dependent rows rather than treating the profile cascade as universal.
7. Normalize the migration ledger. The repo contains duplicate/nonstandard
   migration prefixes and linked-history drift, so a broad `supabase db push`
   is unsafe. Continue applying one reviewed idempotent file at a time until a
   baseline is reconciled and backed up.
8. Add device/process/user/task-bound attestation to local bridge pairing and
   keep loopback health, observation, and mutation authority separate.
9. Run two-client behavioral tests for membership removal, Realtime, invite
   consumption, RLS visibility, and concurrent RPC claims. Catalog checks do
   not prove race behavior.
10. Review shared-member profile projections so sensitive future profile
   columns cannot become visible merely because table SELECT is allowed.
11. Re-run dependency and bundle secret scans on the exact production artifact;
   resolve the remaining production moderate advisories and Stagehand's
   development-only high advisory when compatible releases are available.

## Release evidence checklist

The security release is not complete until all applicable rows are current:

| Evidence | Review state |
|---|---|
| Live database grants/RLS/catalog | Verified after remediation |
| Credential-key rotation and row decryptability | Site credentials verified live; follow-up audit found 7 omitted `user_api_keys` rows unreadable under the current key. Ciphertext preserved; old-key recovery or owner re-entry required; no values printed |
| OAuth token browser boundary | Verified live; raw tables service-only; unauthenticated REST rejected |
| Circle integration-secret migration | Verified live; 8/8 versioned ciphertext rows decryptable; no values printed |
| Profile/circle/member/default-thread schema invariants | Verified live; no creator/default-thread gaps |
| Live weak-password rejection | Verified; no user created |
| Hosted Auth session lifecycle | Verified with temporary user; replay rejected; cleanup verified |
| Live unauthorized privileged-function canaries | Verified for reviewed functions |
| Live `automation-executor`, `github-webhook`, and `swanbot-ai` deployments | Verified with bounded unauthenticated canaries |
| Authenticated local and production Chat `/help` E2E | Passed; command catalog visible; zero lazy-module failures; cleanup complete; no test residue |
| Full `check:security:release` gate | Passed, including app/function typechecks and web export |
| Source auth/OAuth/logout/CSP smokes and typechecks | Verified in the review worktree |
| Production/exported bundle provider-secret scan | No usable secrets found |
| Fresh production frontend deploy | Verified 2026-08-06 — Netlify deploy `6a752a514ea89752b1464f77`; local/production/unique-deploy HTML hashes matched; fresh root/Auth/Main/Circle/Chat graph and JavaScript revalidation headers verified |
| Real signup/confirmation/reset email flow | Not exercised |
| Real third-party OAuth completion | Not exercised |
| Two-client RLS/Realtime/concurrency behavior | Not exercised |
| Account deletion with all dependent-row classes populated | Not exercised; residual `NO ACTION` FKs remain |
| Private task-image delivery | Not implemented |
| Device-bound local bridge authority | Not implemented |
| Metro dependency-change auto-restart | Verified only through `npm run start`; standalone Expo remains manual |

Future agents must update this record only with new dated evidence. Never turn
a source assertion, catalog listing, or successful HTTP reachability probe into
an end-to-end production security claim.
