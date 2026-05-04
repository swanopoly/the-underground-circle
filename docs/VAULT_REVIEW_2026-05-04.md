# Vault page — full review and roadmap

Date: 2026-05-04
Scope: `src/screens/circles/tabs/VaultTab.tsx`, `src/components/vault/SiteCredentialVaultPanel.tsx`,
`src/lib/siteCredentialVault.ts`, `supabase/migrations/20260407_site_credentials.sql`,
`supabase/migrations/20260413_circle_site_credentials.sql`.

## Summary

The vault works as a basic admin form for storing encrypted site credentials per circle.
Compared with what users expect from a credential vault (1Password, Bitwarden, Doppler) —
and what the agent automation pipeline actually needs — there are real gaps in **data integrity,
UX, security visibility, and discoverability**.

The single most important issue is a **schema/lib mismatch**: the panel and lib reference
fields the migration doesn't create.

---

## P0 — Bugs and broken paths (fix first)

### 1. Schema mismatch with lib expectations

`circle_site_credentials` migration defines 12 columns. The lib + panel read/write 8
additional fields that the migration never created:

| Field used by lib       | Migration                        |
|-------------------------|----------------------------------|
| `secret_kind`           | ❌ missing                       |
| `login_url`             | ❌ missing                       |
| `access_policy` (jsonb) | ❌ missing                       |
| `expires_at`            | ❌ missing                       |
| `rotation_due_at`       | ❌ missing                       |
| `last_used_at`          | ❌ missing                       |
| `last_used_by`          | ❌ missing                       |
| RPCs (`list_*`, `store_*`, `get_*`, `delete_*`) | ❌ missing — referenced by lib + edge fn but no migration defines them |

Either the deployed DB has these and the repo migrations are stale, or every store/list call
silently fails server-side. The lib's `isSiteCredentialVaultMissing()` heuristic catches the
"function not found" case but the user only gets a one-line "vault missing" warning.

**Action**: ship a migration that brings the table + RPCs in line with the lib. Include
encryption key resolution (today's `credential_encrypted` is a single TEXT column — pgcrypto
or app-side AES needs to be defined).

### 2. Hard-coded platform CHECK constraint

```sql
platform text NOT NULL CHECK (platform IN (
  'wordpress', 'shopify', 'squarespace', 'wix',
  'twitter', 'instagram', 'linkedin', 'facebook',
  'mailchimp', 'sendgrid', 'convertkit',
  'quickbooks', 'stripe', 'square',
  'cloudflare', 'vercel', 'netlify',
  'google_analytics', 'google_search_console',
  'hubspot', 'salesforce', 'pipedrive'
))
```

A user trying to save Klaviyo, Intercom, Plausible, Linear, Notion, GitHub, Airtable, Render,
Supabase admin, or any internal tool gets a constraint violation. The panel doesn't validate
platform against a known list, so the user sees a raw DB error.

**Action**: drop the CHECK or move to a soft enum (text + `lower(platform)` index).

### 3. Nested scroll regions

`VaultTab` wraps the panel in a `<ScrollView>`, and `SiteCredentialVaultPanel` mounts its own
`<ScrollView>` with `maxHeight: 440`. On web that produces a 440px fixed-height inner box
inside a page-scrolling outer box — the user can scroll the page past the panel, but
credentials below the inner cap require a separate gesture. On mobile, nested vertical
scrolls are an interaction warning.

**Action**: drop the inner `ScrollView`, let the outer one own scrolling.

### 4. Full reload after every mutation

`handleSave`, `handleDelete`, `handleReveal` all call `loadVault()` to refresh, which fires a
fresh `list_circle_site_credentials` RPC. Optimistic UI is partially implemented (delete and
reveal touch local state) but inconsistently — save bypasses optimism and round-trips.

**Action**: optimistic insert on save, normalize all three mutations to use the same
local-state pattern.

---

## P1 — UX gaps

### 5. No search / filter / grouping

Flat alphabetical list. With 20+ credentials this is unusable. No way to:
- filter by platform
- show only credentials due for rotation
- group by site domain
- mark favorites

### 6. New-credential form is one tall column of 8 fields

8 inputs stacked vertically with no progressive disclosure. Most credentials only need
`platform + secret`; the rest is optional. Form should default-show the minimum and reveal
the rest on demand.

### 7. No password generator

Industry standard. One-tap "generate strong password" should sit next to the SECRET field.

### 8. Reveal timer is fixed at 30s

Hard-coded `Date.now() + 30_000`. Some workflows need 10s (paste once, done); others need
2 minutes (multi-step setup). Should be configurable + show countdown.

### 9. No usage history surfaced

Schema has `last_used_at`/`last_used_by` (assumed) but the panel only renders the bare
"Last used" string. No "who used this in the last 7 days" timeline. For a vault this is the
audit trail — without it, a leaked secret is invisible.

### 10. "+/-" chevrons instead of `▸/▾`

Minor but inconsistent with the rest of the app (Office panel, OpenSwan Console all use the
unicode arrows). Looks like a debug placeholder.

### 11. No empty-state CTAs by platform

The empty state says "Add WordPress, Shopify, Webflow, cPanel" as text but doesn't seed the
form for any of them. A grid of platform tiles ("WordPress", "GitHub", "Stripe", ...) would
prefill `platform`, `loginUrl`, `secretKind` correctly per platform.

### 12. Approval checkbox is binary, not workflow-aware

`require_approval` is on/off. There's no UI for who approves, who's notified, or what
counts as approved (single member? majority? owner?).

---

## P2 — Security visibility

### 13. No reveal audit log shown to user

Reveals call `get_circle_site_credential_secret` with a `purpose` string. That purpose is
presumably logged server-side, but the panel doesn't display recent reveals. A user can't
tell if their credential was revealed by another circle member or an agent.

### 14. No 2FA gate on reveal

For high-trust credentials (Stripe live keys, AWS root) the reveal should require a fresh
auth challenge. Today: any session that can list can also reveal.

### 15. Symmetric encryption key origin is undocumented

`credential_encrypted text NOT NULL` — encrypted with what, where's the key, who can decrypt?
Without docs the security model is opaque.

### 16. RLS doesn't gate the encrypted blob

```sql
CREATE POLICY circle_site_credentials_select
  ON circle_site_credentials FOR SELECT TO authenticated
  USING (circle_id IN (
    SELECT circle_id FROM circle_members WHERE user_id = auth.uid()
  ));
```

Any circle member can `SELECT *` and read the `credential_encrypted` blob. If decryption is
client-side, that's a leak. If decryption is server-side via the RPC, the policy is fine but
the lib's RPCs need to be the only path.

### 17. No "compromised password" check

Industry standard since 2018: send the SHA-1 prefix to HaveIBeenPwned, get back a list of
suffixes that have been seen in breaches. No round-trip ever sees the actual password.

---

## P3 — Agent integration gaps

### 18. Hardcoded `allowed_actions: ['login', 'post', 'edit']`

Wired into the panel's `accessPolicy` builder. User can't change which actions are allowed
per credential. A "read-only analytics" credential and an "I can publish" credential should
have different allowlists.

### 19. No credential-tied tool routing

`findSiteCredentialForUrl(circleId, url)` exists in the lib but nothing in the panel shows
the user which credentials are wired to which auto-detected URLs.

### 20. No `/vault` slash command in chat

User has to leave chat → tab nav → vault. A `/vault save` flow that opens a quick form, or
`/vault find <url>` that returns the matching credential, would close the loop.

### 21. No "test credential" affordance

Click "test" → visit the login URL via the browser bridge → report whether the agent
successfully authenticated. Today the user only finds out a credential is stale when an
automation fails.

---

## P4 — Missing features competitors have

| Feature | Competitor | Status |
|---|---|---|
| TOTP / 2FA seed storage | 1Password, Bitwarden | ❌ |
| Passkey / WebAuthn refs | 1Password | ❌ |
| Secure notes | Bitwarden, 1Password | ❌ |
| Identity records (cards, addresses) | 1Password | ❌ |
| Folders / tags | All | ❌ |
| CSV import | All | ❌ |
| CLI access | Doppler, 1Password CLI | ❌ |
| Browser extension | All | ❌ |
| Sharing with specific members | 1Password Teams | ❌ (binary circle access only) |
| Activity audit log | Doppler, 1Password | ❌ visible in UI |
| Compromised check | HaveIBeenPwned via 1Password, Bitwarden | ❌ |

---

## Recommended build order

### Sprint 1 — fix bugs
1. Migration: bring `circle_site_credentials` columns + RPCs in line with lib
2. Drop or expand the platform CHECK constraint
3. Drop the nested ScrollView
4. Optimistic save (no loadVault round-trip)

### Sprint 2 — UX core
5. Search + filter
6. Password generator
7. Configurable reveal timer (10s / 30s / 60s)
8. Recent reveals list per credential
9. Platform-tile empty-state CTAs

### Sprint 3 — agent loop
10. `/vault save` and `/vault find` slash commands
11. `Test credential` button (visit login URL via bridge, report status)
12. Per-credential tool/action allowlist editor
13. Credential rotation reminder strip in the panel header

### Sprint 4 — security
14. Reveal audit log (visible to circle owners)
15. 2FA gate before reveal for "high trust" credentials (user-tagged)
16. HaveIBeenPwned k-anon prefix check on save
17. Document encryption model in `docs/SECURITY.md`

### Sprint 5 — competitive
18. TOTP seed + code generation
19. CSV import (1Password format first)
20. Folders / tags
21. Per-member sharing inside a circle (not just binary access)

---

## Non-goals (don't build)

- Browser extension (out of scope; UC isn't a password manager)
- Mobile autofill (relies on platform-specific APIs we don't ship)
- Passwordless auth flows for UC itself (separate concern)
- Generic "secrets manager" for env vars (Doppler / Infisical own that space; UC vault is
  for **agent-driven web automation**, keep focus narrow)

---

## Code-level cleanup notes

- `SiteCredentialVaultPanel.tsx` is 665 lines with three concerns (form / list / reveal
  timer). Split into `VaultEntryForm.tsx`, `VaultEntryRow.tsx`, `useRevealTimer.ts`.
- `expandedId` defaults to literal `'new'` — use a typed enum (`'new' | string | null`) and
  document the magic value.
- `accessPolicy.allowed_actions` builder is hardcoded inline at line 132 — move to a
  per-platform default map.
- `isSiteCredentialVaultMissing` heuristic in lib relies on substring matching of error
  messages — fragile if Postgres changes wording. Tighten to PGRST202/204 codes only.
- No optimistic UI state machine — the form blocks during save, no spinner on reveal.
