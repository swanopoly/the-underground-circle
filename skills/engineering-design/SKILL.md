---
name: engineering-design
description: Design, size, analyze, and model a mechanical/structural/thermal/fluid part or machine element from first principles — with NO CAD install — by chaining the engineering tools as one pipeline (size → draw → model → measure → tolerance) and cross-checking every result. Use for "design/size/model/draw/analyze a [bracket/shaft/gear/beam/spring/bolt/pipe/cam/…]", "how thick/strong/what fits/what torque/will it hold", bending/stress/deflection, gears/bearings/belts/screws, heat transfer, pipe flow, fits/tolerances, or "generate a CAD part / STL / DXF".
version: 1.0.0
tags: [engineering, mechanical, structural, cad, analysis, size-model-measure, no-install]
---

# Engineering Design

Turn an engineering duty ("carry 800 N", "transmit 3 kW at 3:1", "hold pressure",
"run this fluid") into a **sized, drawn, modeled, measured, toleranced** part —
entirely from formulas and generated geometry, with **no CAD application
installed**. The value is that the tools COMPOSE: each output is the next tool's
input, so you design the whole part, not one number.

## Procedure

The pipeline is `size → draw → model → measure → tolerance`:

1. **Size — `engineering.calc`.** Get the material first (`kind:"material"` → E, G,
   α, k, yield, density), derive an allowable from yield ÷ safety factor, then
   size with the right kind: `beam` (deflection/stress), section properties,
   `column_buckling`, `shaft_torsion`, `pressure_vessel`, `thermal_expansion`,
   `spring_rate`, `gear_pair`/`gear_train`, `bearing_life`, `belt_drive`,
   `power_screw`, `bolt_preload`/`tap_drill`, `pipe_flow`,
   `conduction`/`convection`/`composite_wall`, `natural_frequency`, `four_bar`,
   `iso_fit`/`tolerance_stack`, or electrical. Round a required dimension UP to a
   standard size, then RE-CHECK the actual stress/life/fit at that size.

2. **Draw — `engineering.draft_dxf`** (optional 2D): floorplan / schematic /
   boltcircle / gear / custom → a verified DXF. Write it with
   `desktop.file_write_text` (request one `approvals.request` first — a file write
   is a mutation).

3. **Model — `engineering.model_3d`** emits a Blender `bpy` for the 3D solid
   (plate/bracket/tube/flange, gear/gear_pair/helical_gear/rack,
   extrude/revolve/pulley, spring/thread/bolt/nut, beam/frame, elbow, cam,
   sheet_metal, or `custom` CSG). Write the `.py` with `desktop.file_write_text`
   (approved), then run `desktop.cad_compile { engine:"blender", sourcePath:<.py>,
   outputPath:<.stl> }` → a watertight STL.

4. **Measure — `engineering.inspect_mesh`** (or `desktop.file_stat` to confirm the
   STL was written) reads the part back: bounding box, volume, watertight check,
   mass. Confirm the manufactured part matches the design.

5. **Tolerance — `engineering.calc iso_fit` / `tolerance_stack`** turns nominal
   dimensions into limits, a fit (clearance/interference), and worst-case + RSS
   stack-ups — the manufacturable finish.

**Compose at the seams:** the section the geometry provides is the section the
stress calc consumes; the sized thickness is the model's height; the diameter the
fit sizes is the model's bore; mass = the model's volume × the material's density.

## Pitfalls

- **A model that isn't watertight is not a valid part.** If `inspect_mesh` reports
  open or non-manifold edges, the geometry is wrong — fix it, never report success.
- **Don't skip the re-check after rounding.** A 10.7 mm requirement becomes a 12 mm
  plate; then confirm the stress AT 12 mm is still under allowable, don't assume.
- **Don't route this to GUI computer-use.** These tools are pure computation plus a
  headless `desktop.cad_compile`; an engineering-part request never needs
  screenshots or clicking an app.
- **Don't report a bare number.** State the safety RESULT — the realised safety
  factor, the guaranteed clearance, whether a screw is self-locking, whether a
  column is slender enough for Euler.
- **Mind the units and forms.** The mm/N/MPa system keeps mechanical formulas
  factor-free; fluids/heat use SI. Beam load is `point_end`/`point_center`/`udl`.

## Verification

- **Cross-check every generated solid** against its independent closed-form volume
  (area×height, Pappus, inclusion–exclusion, Cavalieri, developed length) via
  `engineering.inspect_mesh`; a match to a fraction of a percent means the geometry
  is right and watertight.
- **Sanity-check every calc** against the known formula and expected magnitude —
  these are textbook-exact, so a wildly off number means a bad input or unit.
- **The pipeline is proven to compose.** `docs/ENGINEERING_WORKFLOW.md` walks a
  cantilever **bracket** (statics) and a **gear reducer** (transmission);
  `npm run smoke:engineering-workflow-integration` and
  `npm run smoke:engineering-gearbox-integration` assert the numbers flow across
  the tools, and `npm run drill:engineering-workflow-e2e` measures a 577 g designed
  bracket back as 577 g. Follow that pattern: end each design by confirming the
  measured part equals the designed one.
