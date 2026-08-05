# Plan Document Audit — 2026-04-15 (status notes refreshed 2026-07-13)

This file is now the canonical audit of the repo's planning documents.
It replaces the older feature-status snapshot that had gone stale.

## Living docs to keep

These are still useful, still referenced, or still govern unfinished work:

- `docs/NEXT_LEVEL_PLAN.md`
  - still referenced by missions / proof-of-work / gating code
  - remains the broad product strategy doc
- `docs/OFFICE_ROADMAP.md`
  - still referenced from repo guidance
  - remains the high-level Office product direction
- `docs/OPENSWAN_CHAT_ARCHITECTURE_PLAN.md`
  - active architecture reference for OpenSwan/chat runtime
- `docs/CHAT_LIVE_BUILDER_ROADMAP.md`
  - still referenced from builder code and prompt docs
  - still relevant because the builder is only partially complete
- `docs/AGENT_MEMORY_GOD_PLAN.md`
  - still referenced directly from memory/runtime code
  - remains the canonical memory architecture doc, but its §1 gap table is
    historical — every listed gap except live-builder capture shipped by
    2026-04-18 (see the shipped-status note inside the doc)
- `docs/SOULS_SPIRITS_SKILLS_ROADMAP.md`
  - still referenced from SOUL/spirit docs and still unfinished
- `docs/OPENSWAN_SUBAGENT_ARCHITECTURE_PLAN.md`
  - substantially shipped (`subagentCapabilities.ts` + registry consumption);
    keep as design rationale, not as an open backlog
- `docs/OPENSWAN_AGENT_IMPLEMENTATION_PLAN.md`
  - still relevant for typed runtime / verification / workspace work

## Removed as redundant or stale

These were deleted because they no longer add unique planning value:

- `docs/IMPLEMENTATION_ROADMAP.md`
  - redundant with `docs/OFFICE_ROADMAP.md`
  - overly tactical and partially obsolete
- `docs/TODO_OFFICE.md`
  - very old pre-live Office checklist
  - superseded by the current Office roadmap and shipped code
- `docs/master-plan-addendum-2026-04-08.md`
  - one-time merge note / handoff artifact
  - not a living plan

## Intentionally not removed

- `docs/page-audits/*`
  - many of these are historical audits or implementation dossiers, not the
    main living plan set
  - they may still contain useful rationale and defect history even when the
    implementation has moved on
- `docs/wiki/*`
  - these are content/reference documents, not plan clutter

## Current guidance

If a future agent needs planning context, the preferred reading order is:

1. `docs/NEXT_LEVEL_PLAN.md`
2. `docs/OFFICE_ROADMAP.md`
3. `docs/OPENSWAN_CHAT_ARCHITECTURE_PLAN.md`
4. `docs/AGENT_MEMORY_GOD_PLAN.md`
5. `docs/CHAT_LIVE_BUILDER_ROADMAP.md`
6. `docs/SOULS_SPIRITS_SKILLS_ROADMAP.md`

## Audit rule going forward

Delete a plan doc when at least one of these is true:

- it is fully superseded by a newer living doc
- it is only a session handoff / addendum / merge note
- the codebase no longer references it and its roadmap has already shipped
- its remaining useful content has been merged into a stronger canonical doc
