# Canonical skills

Reference [agentskills.io](https://agentskills.io)-format `SKILL.md` procedures
maintained in-repo (reviewable, version-controlled) and seedable into a circle's
`circle_skills` library via `src/lib/skillLibraryWrite.ts`. Once seeded, the
agent sees the metadata row (name + description + tags) through the relevance-
ranked skills block and pulls the body on demand with `viewLibrarySkill(name)` /
the `skill_view` tool — the progressive-disclosure pattern.

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
| [`design-app-export`](./design-app-export/SKILL.md) | Export/package a proof from Photoshop/InDesign — document-status + preflight checks first, explicit format/preset/path, approval-gated write, and `file_stat`-verified output (no assumed proof). |
