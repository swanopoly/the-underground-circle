# The Underground Circle — Branding & Design Review

> 2026-07-07. Code-level inventory of the app's actual brand/design
> implementation (file:line evidence) crossed with researched 2025-26
> practice for AI-agent workspaces (claims adversarially verified; vendor
> stats directional). No visual rendering was done — this is a structural
> review. Deliverable: findings + a prioritized, effort-rated plan.

## The five findings that matter

### 1. Brand-entity sprawl — users meet three swans and four product names

Measured in user-facing strings: "The Underground Circle" (8+ uses),
"Underground Circle" without "The" (invites, MCP client, gateway docs),
lowercase "circle" in prose, web shortName "TUC", plus **BlackSwan** (15+,
incl. empty-state CTAs like "Ask BlackSwan to generate an image…"),
**OpenSwan** (5+, gateway/docs copy), SwanBot (code-level), and Swanopoly
(repo org). The login hero even splits the name across three lines.

Industry reality (verified): Notion named its agent "Agents"; Slack reused
"Slackbot"; Cursor coins names **only for models** (Composer); Microsoft's
~80 "Copilot"-branded products drew a BBB NAD ruling that users "would not
necessarily understand the differences." The converged pattern: **one
master brand, a generic/descriptive agent name, coined names reserved for
models.**

**Naming menu** (all presentation-layer only — `default::blackswan` and
internal ids untouched):
- **Option 1 (recommended, M)**: full name stays at the login wordmark;
  seed **"the Circle"** as the official in-app short form; ONE user-facing
  agent identity in chat (each circle can name its own); **BlackSwan
  survives only in the model picker** (like Composer); OpenSwan becomes
  "agent runtime" in copy.
- **Option 2 (S)**: keep all names but enforce strict lanes (product name
  login/OG only; SwanBot the only chat-visible agent; OpenSwan out of UI
  copy; BlackSwan model-picker only).
- **Option 3 (L, only if renaming anyway)**: consolidate the product AS
  "BlackSwan" (Bard→Gemini precedent) — highest upside, real migration
  risk (Twitter→X is the cautionary tale).

### 2. The first impression contradicts the product

The login screen runs a **lime-green accent (#b8ff61)** while the entire
app runs **indigo (#6366f1)** — two unrelated identities at the moment of
highest brand attention. The web deploy's og:image is the square app icon,
not a 1200×630 card, while twitter:card claims `summary_large_image` —
shares render broken-ish. No PWA manifest icons (Chrome install warning
threshold is the 512px icon).

### 3. The design system exists but the app ignores it

`pixelDesign.ts` defines a coherent ~20-token graphite palette — and the
screens use **1,234 distinct hex literals** across **350
StyleSheet.create blocks**, with exactly **two shared primitives**
(Button, Card — and Card hardcodes its own hex). Typography is all inline
(13 ad-hoc sizes), no custom fonts (fine — system stacks are the norm),
dark-only (also fine — dev-tool norm; Linear ships near-black #08090A + one
accent encoded in ~3 semantic variables). Research verdict for RN-web
2025-26: **tokens first, library second** — a plain TS semantic-token
module + Box/Text/Button primitives, no Tamagui/NativeWind adoption now
(v2 RC / "not for production" respectively).

Accessibility spot-check: ghost text `#3e3e3e` on `#0a0a0a` is ~2.2:1 —
fails WCAG for any readable use; 217 accessibilityLabels is decent
coverage; custom focus handling on login risks keyboard nav.

### 4. The product's soul — accountability receipts — has no signature UI

The plumbing is exceptional (evidence contracts, approval gates,
agent_run_events, proof receipts) but it renders as scattered per-surface
UI. The strongest verified 2025-26 trust patterns are exactly what this
app already has data for: GitHub Copilot commits link to session logs;
Operator's confirmations cut risk ~90% (system card); Devin's plan-first
+ replay timeline; Manus made shareable replays a viral mechanic. The
research's named patterns: **Intent Preview** approvals (what/why/risk +
proceed/edit/I'll-do-it — never bare approve/deny), **risk-tier chips**
(read / reversible / external / irreversible — maps 1:1 to the existing
approval floors), **Action Audit & Undo**, autonomy as a dial with
earned trust.

### 5. First-run is a cliff

Auth → CirclesScreen. No onboarding, no demo content, empty states with
inconsistent voice ("Ask BlackSwan…" vs "No missions yet"). Verified
patterns: Linear pre-populates demo data ("let users delete rather than
create"); 3-step onboarding completes at 72% vs 16% for 7-step; best AI
products hit a wow in <3 minutes via ONE guided task.

## What's already good (keep)

Dark-first graphite instinct matches the dev-tool norm; the voice is
distinctive and confident ("Get back inside." / "Your agents are
waiting."); office theme system is genuinely rich; spacing GRID tokens
exist; the value prop line is strong; 🪄 routing-notice sigil is a nice
consistent tell; accessibilityLabel coverage is real.

## Prioritized plan (effort-rated)

| # | Action | Effort |
|---|---|---|
| 1 | Naming-lanes pass (Option 1 or 2): one agent name in chat, OpenSwan out of copy, BlackSwan → model picker only, seed "the Circle" | S-M |
| 2 | Login/share surface: align login accent to the app accent, proper 1200×630 og:image, manifest + 192/512 icons | S |
| 3 | `src/theme/tokens.ts` (semantic, DTCG-shaped) + Box/Text/Button primitives; new code on-system; migrate ChatTab bubbles first | M |
| 4 | **The Receipt** — one reusable card (action + proof + approver + risk tier + retry/undo) from existing evidence metadata, identical in Chat/Feed/Office | M |
| 5 | Intent-preview approvals + risk-tier chips on the existing gates | M |
| 6 | Signature agent working-state motion (shimmer 1.5-2s, amber >10s, reduced-motion safe) across Chat/Office | M |
| 7 | Demo circle + guided <3-min first task + suggested-task chips in every empty state | M |
| 8 | Delegate-not-assignee semantics on missions (human stays owner, agent is delegate — Linear's validated model) | S |
| 9 | Manus-style computer-use proof panel (live screenshot + plain action log; dev detail behind a toggle) + shareable replays | L |
| 10 | Office as agent command center (Kanban by working/blocked/ready-for-review) | L |

Sequencing: 1+2+8 ≈ a weekend of polish; 3 must precede 4-6 (components
born on-system); 9-10 ride on plumbing that already exists.

## Benchmark set (screenshot these three)

Linear (agent profiles, delegation semantics, integration directory) →
Office/Feed/Marketplace · Devin Desktop (command-center Kanban, editable
plan view) → Office · Manus (computer panel + task replay) → Computer Use.
Raid singles: Cursor 2.0 aggregated diffs; ChatGPT agent's activity-view
toggle; Claude Cowork's "nothing ships until you approve" copy.
