---
name: design-app-edit
description: Create, restyle, or rearrange objects in Photoshop/Illustrator (add text, recolor/fill, align/arrange/group, vectorize, opacity/blend, transform) using the deterministic typed op — observed first, approval-gated, verified by re-reading inventory. Use for "add a headline / recolor / set opacity / align / group / vectorize / add a background fill" requests on a PSD or AI.
version: 1.0.0
tags: [photoshop, illustrator, adobe, design, edit, add-text, headline, recolor, restyle, fill, background, align, distribute, arrange, group, vectorize, opacity, blend, adjustment, transform, observe-act-verify, approval]
---

# Design App Edit

Creating, restyling, or rearranging objects mutates the open document in place —
a real side effect on layers/objects the user cares about. Observe the document
and its inventory first, map the request to the single exact deterministic op
(never blind menu/coordinate clicks), gate the mutation behind approval, run one
op, and prove the change by re-reading the inventory — not by trusting the tool's
return value.

## Procedure

1. **Observe before any edit** — open or focus the app and read live state first;
   never edit an unobserved document:
   - Photoshop: `desktop.photoshop_document_status` + `desktop.photoshop_layer_inventory`
     (dimensions, color mode, layer tree, active selection, saved state).
   - Illustrator: `desktop.illustrator_document_status` (artboards, selection,
     objects/layers).
   Capture the before-state you will diff the result against.

2. **Map the request to the EXACT deterministic op** — pick the single typed
   adapter that names the intent, and prefer it over coordinates/menus/dialogs:
   - Illustrator: `desktop.illustrator_add_text` (add text / headline),
     `desktop.illustrator_set_appearance` (recolor / restyle / fill / stroke /
     opacity / blend), `desktop.illustrator_add_shape` (draw a shape / background),
     `desktop.illustrator_align` (align / distribute),
     `desktop.illustrator_arrange` (reorder / position / transform),
     `desktop.illustrator_group` (group / ungroup),
     `desktop.illustrator_add_artboard` (new artboard),
     `desktop.illustrator_vectorize` (image trace → vector).
   - Photoshop: `desktop.photoshop_create_text_layer` (add text / headline),
     `desktop.photoshop_set_layer_appearance` (opacity / blend mode / effects /
     restyle), `desktop.photoshop_add_fill_layer` (solid / gradient fill or
     background), `desktop.photoshop_apply_adjustment_layer` (color / tonal
     adjustment), `desktop.photoshop_transform_layer` (move / scale / rotate /
     flip), `desktop.photoshop_manage_layers` (create / group / reorder / rename /
     delete).
   State the op and its arguments explicitly; do not drive the UI by coordinates
   when a typed op names the intent.

3. **Approval-gate the mutation** — `approvals.request` before running the op.
   Surface which document/layer/object it changes and that it edits in place.

4. **Run exactly one op** — invoke the single chosen adapter with explicit
   arguments. One bounded mutation at a time; re-observe between steps rather than
   batching blind edits.

5. **Verify by re-reading inventory** — after the op, re-read
   `desktop.photoshop_layer_inventory` / `desktop.photoshop_document_status` or
   `desktop.illustrator_document_status` and confirm the expected new or changed
   layer/object/appearance is actually present. Trust the refreshed inventory plus
   the op's receipt, not the tool's return string.

6. **No typed op? Build one, never guess** — if no deterministic adapter names the
   requested edit, `research.search` the app's scripting API and hand off
   `agent.build_app_capability` to add a typed op with a focused smoke. Never fall
   back to blind coordinate/menu clicking for a mutation.

## Pitfalls

- **Editing an unobserved document** — always read status + inventory first and
  capture a before-state to diff against.
- **Blind coordinate/menu clicks** when a deterministic typed op names the intent
  (add text, recolor, align, transform, …) — prefer the adapter.
- **Wrong op for the intent** — e.g. treating "add a headline" as a resize, "set
  50% opacity" as a rasterized effect, or "white background fill" as a linked-asset
  swap. Match the intent to the precise op.
- **Mutating without approval** — object/layer edits are in-place; gate them.
- **Trusting the tool return as proof** — confirm by re-reading the inventory, not
  the returned string.
- **Batching many blind edits** — run one op, re-observe, then continue.
- **Wrong active document/layer** — verify identity before mutating.

## Verification

- **Pre-edit:** correct active document observed, before-state inventory captured,
  the exact deterministic op + arguments chosen, approval granted.
- **Post-edit:** refreshed `..._layer_inventory` / `..._document_status` showing
  the new or changed layer/object/appearance; the op's receipt reconciled against
  it.
- **A creative edit is only "done" when a re-read inventory shows the change.** If
  it can't be confirmed, report the blocker rather than claiming success.
- **Capability gap:** if the op didn't exist, the handoff to
  `agent.build_app_capability` (with a smoke) is the deliverable — not a blind
  coordinate workaround.
