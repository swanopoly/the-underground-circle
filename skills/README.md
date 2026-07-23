# Canonical skills

Reference [agentskills.io](https://agentskills.io)-format `SKILL.md` procedures
maintained in-repo (reviewable, version-controlled) and seedable into a circle's
`circle_skills` library via `src/lib/skillLibraryWrite.ts`. Once seeded, the
agent sees the metadata row (name + description + tags) through the relevance-
ranked skills block and pulls the body on demand with `viewLibrarySkill(name)` /
the `skill_view` tool — the progressive-disclosure pattern.

**Seeding into a circle:** `node scripts/build-canonical-skills-seed.mjs --circle <circle-uuid>`
emits idempotent `INSERT … ON CONFLICT (circle_id, name) DO UPDATE` SQL (dollar-quoted
bodies, `author_id` = the circle's creator) to run in the Supabase SQL editor / psql.
Re-running refreshes content; reverse with `DELETE FROM circle_skills WHERE circle_id = '<id>' AND name IN (...)`.

Each skill is `skills/<name>/SKILL.md` with YAML frontmatter
(`name`, `description`, `version`, `tags`) followed by `## Procedure`,
`## Pitfalls`, and `## Verification` sections. They are validated by
`npm run smoke:canonical-skills` (each parsed with the real
`parseSkillFrontmatter`; required sections, real tool references, per-skill
content probes, and no path/secret leaks). When you add a skill, add a probe
entry in `scripts/canonical-skills-smoketest.ts`.

| Skill | What it gives the agent |
|---|---|
| [`app-task-automation`](./app-task-automation/SKILL.md) | The reliable observe→find→act→verify loop for completing a task in **any** desktop/web app — universal find-ladder, research-when-unfamiliar, connected-agent buildout on capability gaps, and proof-based completion. Exercises the verification gate + resume checkpoint + app-adapter-gap pipeline. |
| [`browser-form-submission`](./browser-form-submission/SKILL.md) | Fill + submit a web form safely — semantic role/label locators, vault-backed credentials, CAPTCHA/MFA human-gate stops, approval-gated submit, and accepted-state verification (no double-submit). |
| [`design-app-edit`](./design-app-edit/SKILL.md) | Create/restyle/rearrange objects in Photoshop/Illustrator (add text, recolor/fill, align/arrange/group, vectorize, opacity/blend, transform) — observe status + inventory first, map to the EXACT deterministic typed op (not coordinates/menus), approval-gated mutation, and verify by re-reading inventory; `agent.build_app_capability` when no typed op exists. |
| [`design-app-export`](./design-app-export/SKILL.md) | Export/package a proof from Photoshop/InDesign — document-status + preflight checks first, explicit format/preset/path, approval-gated write, and `file_stat`-verified output (no assumed proof). |
| [`file-organization`](./file-organization/SKILL.md) | Find/rename/move/sort/trash local files within approved scopes — grant + approval gates, exact identity resolved via `file_search`/`file_stat` first, non-destructive defaults, and before/after `file_stat` proof. |
