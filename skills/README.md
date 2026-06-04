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
`npm run smoke:app-task-automation-skill` (parsed with the real
`parseSkillFrontmatter`, checked for required sections + safety).

| Skill | What it gives the agent |
|---|---|
| [`app-task-automation`](./app-task-automation/SKILL.md) | The reliable observe→find→act→verify loop for completing a task in **any** desktop/web app — universal find-ladder, research-when-unfamiliar, connected-agent buildout on capability gaps, and proof-based completion. Exercises the verification gate + resume checkpoint + app-adapter-gap pipeline. |
