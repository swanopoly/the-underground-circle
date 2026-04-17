# SOULs, Spirits & Skills — Roadmap

> Plan for evolving the three-layer agent composition system so agents
> become smarter and close their own knowledge gaps over time.
> Last updated: 2026-04-15

## Current state (audit)

| Layer | File | Size | Shape |
|---|---|---|---|
| **SOULs** | `src/lib/soulTemplates.ts` | 867L / 11 templates | Markdown SOUL.md text. 3 categories (role / specialty / **personality**), only `personality` shown in UI. Flat — no tool binding, no metadata. |
| **Spirits** | `src/lib/agentSpirits.ts` | 1686L / 27 spirits | Rich typed: `systemPromptPrefix`, `skillBundle` id, action/evidence/skepticism postures, `escalationTrigger`. |
| **Career / Ops profiles** | `spiritCareerProfiles.ts` + `spiritOperationsProfiles.ts` | 556 + 278L | Extra metadata tiers. |
| **Skills** | just `skillBundle: string` on Spirit | — | **Vaporware** — an ID label only. No prompts, no tool bindings, no evals. |
| **Soul → Memory** | `agentSoulMemory.ts` | 262L | Scores Spirits against free-text; suggests one. |
| **Subagents** | `subagentCapabilities.ts`, `subagentRegistry.ts` | — | Reference `skillBundleId`. |
| **Knowledge** | `researchKnowledge.ts`, `agentMemory.ts` | 247 + 348L | Free-form memory entries. Not skill-aware. |

**Key gap:** Skills are vaporware. Every improvement below flows from fixing that.

## Target architecture

Three distinct responsibilities:

- **SOUL = identity** (who I am — voice, values, tone, boundaries)
- **Spirit = methodology** (how I work — postures, escalation, evidence)
- **Skill = capability** (what I can do — prompts, tools, evals, examples, version)
- **Runtime Agent** = composed at task dispatch from all three
- **Gap Detector** = scans transcripts/errors → proposes new Skills

Three principles:

1. SOUL / Spirit / Skill have distinct responsibilities
2. Skills must be first-class: typed, versioned, testable, composable
3. Gap detection is a product — every failure is a signal

## Phases (in ROI order)

### Phase 1 — Ship the Skill type (1–2 days)

New `src/lib/skills.ts`:

```ts
export interface Skill {
  id: string;
  version: string;
  name: string;
  summary: string;
  description: string;
  category: SkillCategory;
  tags: string[];
  systemPromptAdditions: string;
  exampleTrajectories: Example[];
  antiPatterns: string[];
  requiredTools: string[];
  optionalTools: string[];
  evals: SkillEval[];
  gapSignals: string[];
  dependsOn?: string[];
  author: string;
  cost_tier: 'free' | 'light' | 'heavy';
  created_at: string;
  updated_at: string;
}
```

Migration: `skills` table + `agent_skills` join (`enabled_at`, `last_used_at`, `success_rate`).

Spirit change: `skillBundle: string` → `defaultSkills: string[]`.

### Phase 2 — Seed 20 essentials (3–4 days)

Five categories × four skills:

- **Research**: `web-research`, `github-research`, `doc-lookup`, `fact-check`
- **Writing**: `blog-writer`, `social-writer`, `technical-writer`, `email-composer`
- **Coding**: `code-explain`, `bug-hunt`, `refactor`, `test-writer`
- **Operations**: `wp-publisher`, `social-scheduler`, `email-automator`, `webhook-trigger`
- **Analysis**: `data-analyst`, `transcript-analyzer`, `competitor-scan`, `metric-watcher`

Each ships with **3 evals**. No skill ships without evals.

### Phase 3 — Soul cleanup (1 day)

Collapse the 11 SOULs to ~6 voice archetypes: `precise | warm | playful | blunt | mentor | hype`. Strip role/methodology from SOULs — that's Spirit territory. Add `pronoun + catchphrase + refusal_style`.

### Phase 4 — Dynamic skill composition at dispatch (2–3 days)

- `src/lib/skillRouter.ts` — embed user message, cosine-match to skill embeddings
- Fallback: keyword + tag match
- UI chip in Agent Console: "🧠 Using skills: web-research + blog-writer"
- Log which skills contributed each turn

### Phase 5 — Knowledge Gap Detection (2 days)

- `gapDetector.ts` scans each assistant turn
- Classifies: `tool-missing | skill-missing | data-missing | context-missing | capability-limit`
- Matching Skill exists → "Learn this skill?" one-click button
- No match → `skill_requests` table with user upvotes
- Positive signals bump `success_rate`

### Phase 6 — Skill Marketplace (3–4 days)

- Sharing across circles (mirrors custom themes)
- `user_skills` + `circle_skills` join tables
- Public registry with version pinning; fork + customize

## Smart-defaults checklist (applied to every skill)

1. 2–3 exemplar trajectories (few-shot)
2. Explicit anti-patterns ("DO NOT hallucinate URLs…")
3. Progressive disclosure (max 1 clarifying question)
4. Evidence thresholds ("require 2+ sources")
5. Termination conditions
6. Output scaffolding (template, not freeform)
7. Self-critique loop before returning

## Integration with current stack

| System | Change |
|---|---|
| `agentSpirits.ts` | `skillBundle: string` → `defaultSkills: string[]` |
| `subagentRegistry.ts` | Uses Skill IDs directly |
| `swanbot-ai` edge fn | Receives `activeSkills[]`, appends to system prompt |
| `scheduled_actions` runner | `wp-publisher` / `social-scheduler` are thin wrappers |
| `hf-proxy` | `image-gen` → FLUX, `transcribe` → Whisper |
| Chat Quick Actions | Palette items become Skill invocations |
| Agent Panel → Spirit tab | Add Skills sub-tab (enabled / success rate / recent uses) |

## Week-1 slice (recommended)

1. Migration `skills` + `agent_skills` (½ day)
2. `src/lib/skills.ts` typed interface (½ day)
3. Seed 5 skills end-to-end: `web-research`, `wp-publisher`, `social-writer`, `bug-hunt`, `email-composer` (2 days)
4. Skill picker in Agent Console Spirit tab (1 day)
5. Runtime composition in swanbot-ai (1 day)

## Eval & iteration

- `skill_runs(skill_id, agent_id, success, cost, latency, user_feedback)`
- Weekly cron: success rate per skill, regressions, top failure patterns
- **Rule:** no skill ships without 3 evals

## Tradeoffs

- Cap library at ~40 skills; composition beats count
- Batch evals nightly, not per-PR
- Write prompts that work across Claude / GPT / GLM / Qwen (no model-specific quirks)
- 6 Souls × 40 Skills × 27 Spirits = 6,480 combos — test representative, not exhaustive
