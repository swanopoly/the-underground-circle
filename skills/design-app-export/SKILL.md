---
name: design-app-export
description: Export or package a proof from Photoshop or InDesign (PNG/JPG/PDF proof, print package) with document status checked first, the output path resolved, export gated behind approval, and the result verified by file_stat — not assumed. Use for "export / save as / proof / package" requests on a PSD/INDD.
version: 1.0.0
tags: [photoshop, indesign, adobe, export, proof, design, observe-act-verify, approval]
---

# Design App Export

Exporting writes a file and often flattens/rasterizes — a real, sometimes lossy
side effect. Confirm the right document is active, resolve the exact output path,
check production blockers (missing links/fonts, overset, color mode) before you
export, gate the write behind approval, and prove the artifact exists afterward.

## Procedure

1. **Resolve target + output** — confirm the staged `.psd`/`.psb` or
   `.indd`/`.idml` and the destination path/format/preset. Use
   `desktop.file_search` / `desktop.file_stat` to verify the source exists; never
   guess the output path.

2. **Open/focus + observe document status** — open or focus the app, then read
   status before any mutation:
   - Photoshop: `desktop.photoshop_document_status` + `desktop.photoshop_layer_inventory`
     (dimensions, color mode/profile, layers, saved state).
   - InDesign: `desktop.indesign_document_status` + `desktop.indesign_text_inventory`
     (pages, missing links/fonts, overset text, preflight blockers).

3. **Clear production blockers first** — if InDesign reports missing links/fonts or
   overset, or Photoshop the wrong color mode/bit depth for the target, resolve or
   surface those before exporting; a proof of a broken document is not a proof.

4. **Confirm export settings** — format (PNG/JPG/PDF/PDF-X), preset, color space,
   range/artboards. State the exact settings; do not silently pick.

5. **Approval gate the write** — `approvals.request` before exporting, saving,
   flattening, overwriting an existing file, or packaging. Surface the output path
   and whether it overwrites.

6. **Run the export**, preferring the deterministic adapter
   (`desktop.photoshop_export_proof` / `desktop.indesign_export_proof`, or
   `desktop.indesign_package_document` for a handoff). If the exact export adapter
   is missing, `research.search` the app's scripting/export API and hand off
   `agent.build_app_capability` to build it with a focused smoke — do not drive the
   Export dialog blindly by coordinates.

7. **Verify the output** — `desktop.file_stat` the produced file: it exists, has a
   nonzero size, the expected format/extension, and (when known) the expected
   dimensions/page count. Re-read document status to confirm no unexpected change.

## Pitfalls

- **Claiming a proof exists** because the export tool returned — confirm with
  `file_stat`, not the tool's say-so.
- **Exporting a broken document** — missing links/fonts or overset text must be
  resolved or surfaced first.
- **Silent overwrite** of an existing file without approval.
- **Lossy mode/flatten** (RGB↔CMYK, bit-depth, flatten/rasterize) done without
  confirming it's intended.
- **Blind Export-dialog coordinates** when a script/adapter route exists or can be built.
- **Wrong active document** — verify identity before exporting.

## Verification

- **Pre-export:** correct active document, no unresolved preflight blockers,
  explicit format/preset/path, approval granted.
- **Post-export:** `desktop.file_stat` proving the output exists (path, size,
  format, and dimensions/page count when known); refreshed document status.
- **Packaging:** the package folder contains the document plus collected
  links/fonts; report the folder summary.
- **An export is only "done" when file_stat confirms the artifact.** If it can't be
  confirmed, report the blocker rather than claiming success.
