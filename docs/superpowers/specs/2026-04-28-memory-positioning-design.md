# Memory Positioning — Design

> **Goal:** Make UC's memory layer a public differentiator. Add a "How
> Memory Works" section to the LandingPage and a `/memory` deep-dive
> page that frames UC's existing+planned architecture in the language
> Mercury's article popularized.
>
> Status: planning · Date: 2026-04-28 · Owner: Swan

---

## 1. Why this, why now

Mercury just published a manifesto-style article (2026-04-27) arguing
that "agent memory" is a different category than "knowledge wiki," and
naming the principles serious systems need: **selective injection,
structured retrieval, scoring, conflict resolution, decay, hybrid
storage.** UC quietly already implements most of these — but visitors
to `app.chrisswanson.xyz` see only "missions / GitHub / proof-of-work."

There's a small window where the public conversation has moved from
"AI is great" to "agent memory is the moat." UC can claim the spot for
the "small dev team accountability" niche by showing — not just
declaring — that its memory layer is the real thing.

This is **not** a request to rewrite the brand. It's a request to add
one section + one page so visitors who care about substance can find it.

---

## 2. Current state

| Surface                            | Memory present?         |
| ---------------------------------- | ----------------------- |
| `LandingPage.tsx` hero             | No mention              |
| `LandingPage.tsx` features grid    | No mention              |
| `LandingPage.tsx` "How it works"   | No mention              |
| `/discover`, `/auth`, `/join/:code`| No mention              |
| Inside the app (`AgentMemoryPanel`)| Yes, but private       |

Visitors have zero way to know the substrate exists. The `MemoryHealthCard`
is a screenshot-grade artifact that we don't currently use for marketing.

---

## 3. Design

### 3.1 New landing page section: "Memory that compounds"

Insert between the existing "How it works" and "Features" sections.
Tone: confident, technical, not preachy. **No knock on Karpathy or
Mercury** — UC stands on its own merits.

```
┌──────────────────────────────────────────────────────────────────┐
│ MEMORY THAT COMPOUNDS                                            │
│                                                                  │
│ Most AI tools forget you between sessions. UC doesn't.            │
│                                                                  │
│ Every conversation, commit, and decision becomes a memory —      │
│ scored by relevance, routed to the right specialist, and decayed │
│ when it stops being true. Your circle's AI gets sharper with use,│
│ not noisier.                                                     │
│                                                                  │
│ ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐          │
│ │ CAPTURE  │  │  ROUTE   │  │ RETRIEVE │  │  INJECT  │          │
│ │ extract  │  │ scope +  │  │ rank by  │  │ budget   │          │
│ │ from turn│  │ specialist│ │ context  │  │ + cite   │          │
│ └──────────┘  └──────────┘  └──────────┘  └──────────┘          │
│                                                                  │
│ [Inside UC's memory engine →]   (links to /memory)              │
└──────────────────────────────────────────────────────────────────┘
```

Visual: 4-card horizontal row on desktop, vertical stack on mobile.
Colors from existing accent palette (#6366f1 / #f59e0b / #22c55e / #22d3ee).

### 3.2 New page: `/memory` — "Inside UC's memory engine"

Long-form deep-dive page. Marketing-grade but technically honest. ~1500 words.

**Section outline:**

1. **The problem with stateless chat** (~200 words)
   - The "retrieve, answer, forget" loop and what it costs.
   - Why context windows alone don't solve it.
   - One short, accurate paragraph mentioning that markdown wikis are
     a clever first step that doesn't scale to autonomous agents.

2. **What UC's circle remembers** (~300 words, with screenshot)
   - Decisions made in chat
   - GitHub events tied to circle members
   - Per-soul specialist knowledge (architect, debugger, reviewer, …)
   - User preferences (with examples)
   - Live screenshot of `MemoryHealthCard` showing real metrics.

3. **The four-pillar loop** (~400 words, with diagram)
   - Capture, Route, Retrieve, Inject — with one concrete example
     per pillar, no jargon, no hand-waving.
   - Reproduce the ASCII diagram from `AGENT_MEMORY_GOD_PLAN.md` §2
     as a clean SVG.

4. **Scoring, decay, and conflict resolution** (~300 words)
   - Importance / confidence / age decay (`× exp(-age_days/30)`)
   - Reinforcement (when Plan A ships)
   - Contradiction detection (newer / higher-confidence wins)
   - Why we delete: "memory drift is a reliability problem, not clutter."

5. **Inspectable by design** (~200 words, with screenshot)
   - "Used N memories" pill (when Plan A ships)
   - Memory panel with pin / dispute / forget
   - The audit log, plain language

6. **Open architecture** (~100 words)
   - pgvector + Supabase RLS
   - MIT-licensed, runs on your team's infra if you self-host
   - Link to repo

CTA at the bottom: same `Start Free` button as landing.

### 3.3 Tone rules

- **No comparisons to other products by name.** UC describes what UC does.
- **No claims about features that aren't shipped.** If Plan A hasn't
  landed yet, the citation-pill section says "shipping" not "shipped."
- **Real screenshots, not mockups.** Use the actual `MemoryHealthCard`
  rendered against demo circle data.
- **No emojis** (per UC style guide preference for professional aesthetic).

### 3.4 Routing

- `App.tsx` adds route `/memory` → `<MemoryDeepDive />`.
- The new section's CTA link uses `Linking.openURL('/memory')` (native)
  or anchor (`<a href>`) on web.
- `/memory` is reachable when not authenticated (it's marketing).

---

## 4. File-level delta map

| File                                          | Change                                            |
| --------------------------------------------- | ------------------------------------------------- |
| `src/screens/auth/LandingPage.tsx`            | NEW section "Memory that compounds" between How-it-works and Features |
| `src/screens/auth/MemoryDeepDive.tsx`         | NEW — deep-dive marketing page                    |
| `App.tsx`                                     | route `/memory` → `MemoryDeepDive`                |
| `assets/marketing/memory-health-card.png`     | NEW — captured screenshot                         |
| `assets/marketing/memory-loop-diagram.svg`    | NEW — clean SVG of the four-pillar loop          |
| `docs/MEMORY_PUBLIC_COPY.md`                  | NEW — frozen copy source-of-truth (so it doesn't drift in code edits) |

---

## 5. Phased rollout

### Phase 1 — Section on landing page (½ day)
- Add the 4-card section. Static copy, no new screens.
- **Exit:** visitors see memory mentioned without having to click further.

### Phase 2 — `/memory` deep-dive page (1 day)
- Build the long-form page.
- Capture/embed real screenshots.
- Wire route.
- **Exit:** visitor clicks "Inside UC's memory engine" → reads full page.

### Phase 3 — Refresh after Plan A ships (½ day)
- Update Plan A "shipping" claims to "shipped."
- Add a 30-second screen recording of the citation-pill UX.
- **Exit:** the page describes reality, not roadmap.

Total: **~2 days, then ½-day refresh once Plan A lands.**

---

## 6. Risks

| Risk                                       | Mitigation                                                 |
| ------------------------------------------ | ---------------------------------------------------------- |
| Marketing claims drift from reality        | `MEMORY_PUBLIC_COPY.md` reviewed every release; no claim ships before code does |
| Section feels grafted-on                   | Use existing FeatureCard + StepCard components, same accent palette |
| `/memory` becomes a legal/SEO liability    | No comparative claims; describe own product only          |
| Solo founder spread thin maintaining copy  | Single MD source of truth; copy edits in one file          |
| Scope sprawl into a full marketing redesign| Hard limit: one section + one page; no nav changes        |

---

## 7. Dependencies

- Plan A (Inspect & Control) doesn't have to ship first, but the
  `/memory` page lands sharper if the citation pill exists. Order of
  operations: **A → B's Phase 2 → A→B refresh.**

---

## 8. Success criteria

- Memory mentioned on landing page above the fold-fold (with scroll).
- Deep-dive page exists at `/memory` and renders correctly on web + mobile.
- Real screenshots, not mockups.
- One link from external write-up (HN, Twitter) to `/memory` within
  30 days of publish — measured by Netlify analytics referrer.
