# Engineering Workflow — the composed pipeline

> How the engineering suite's tools fit together into one design loop.
> The tools are documented per-capability in `CLAUDE.md`; this is the
> **workflow** that chains them, with a worked example and its proofs.

The suite is not a pile of calculators and mesh generators — its value is that
the output of each tool is a valid input to the next. The canonical loop is:

```
  size  →  draw  →  model  →  measure  →  tolerance
  calc     draft    model      inspect     iso_fit / stack
```

- **size** — `engineering.calc` turns a load / duty into a dimension (a plate
  thickness, a shaft diameter, a bolt size). Materials carry E, G, α, k, yield,
  density, so one named material serves every domain.
- **draw** — `engineering.draft_dxf` emits a 2D DXF (floor plan, schematic,
  bolt-circle, gear) with verified layers/entities — no CAD install.
- **model** — `engineering.model_3d` emits a Blender bpy for the 3D solid
  (plate/bracket/tube/flange, gears/racks/helical, springs/threads/bolts/nuts,
  beams/frames, pipes/elbows, cams, sheet metal, custom CSG); `desktop.cad_compile`
  runs it to a watertight STL.
- **measure** — `engineering.inspect_mesh` reads the STL back: bounding box,
  volume (divergence theorem), watertight check, mass. The measure-a-part partner
  to model.
- **tolerance** — `engineering.calc iso_fit` / `tolerance_stack` turns nominal
  dimensions into limits, fits (clearance/interference), and worst-case + RSS
  stack-ups — the manufacturable finish.

Every generated solid is cross-checked against ≥1 independent closed-form volume
(area×height, Pappus, inclusion–exclusion, Cavalieri, developed length); every
calc is pinned to a hand-computed textbook value.

## Worked example — a cantilever bracket

**Duty:** carry **800 N at a 120 mm arm**, in steel, with a safety factor ≥ 2.5;
it bores a **Ø25 shaft** and mounts on four **M10** bolts.

### 1. size — allowable stress → required section → chosen plate

```jsonc
// engineering.calc  kind: "material"   → steel yield 250 MPa, density 7.85e-6, E 200 GPa
// σ_allow = yield / SF = 250 / 2.5 = 100 MPa
// M = P·L = 800 · 120 = 96 000 N·mm ; S_required = M/σ_allow = 960 mm³
// rectangular S = b·h²/6, b = 50 → h_required = √(6·960/50) = 10.73 mm → pick 12 mm
engineering.calc { kind: "section_rectangle", args: { b: 50, h: 12 } }   // → S = 1200 mm³
```

### 2. stress check — the section the geometry gives, consumed by the beam calc

```jsonc
engineering.calc {
  kind: "beam",
  args: { support: "cantilever", load: "point_end", magnitude: 800, length: 120, E: 200000, I: 7200, S: 1200 }
}
// → moment 96 000 N·mm, bending stress 80 MPa  (< 100 allowable ✓)
// engineering.calc { kind: "safety_factor", args: { strength: 250, appliedStress: 80 } }  → 3.125 ≥ 2.5 ✓
```

### 3. model — the plate built with the SIZED 12 mm thickness

```jsonc
engineering.model_3d {
  part: "custom",
  spec: {
    positives: [ { kind: "box", w: 50, d: 140, h: 12, cz: 6 } ],
    negatives: [
      { kind: "cylinder", r: 12.5, h: 14, cy: 45, cz: 6, axis: "z" },   // Ø25 shaft bore
      { kind: "cylinder", r: 5.5,  h: 14, cx: -18, cy: -55, cz: 6, axis: "z" },  // 4× Ø11 bolt holes
      { kind: "cylinder", r: 5.5,  h: 14, cx:  18, cy: -55, cz: 6, axis: "z" },
      { kind: "cylinder", r: 5.5,  h: 14, cx: -18, cy: -35, cz: 6, axis: "z" },
      { kind: "cylinder", r: 5.5,  h: 14, cx:  18, cy: -35, cz: 6, axis: "z" }
    ]
  }
}
// → Blender bpy; desktop.cad_compile { engine: "blender", sourcePath: <.py>, outputPath: "bracket.stl" }
```

### 4. measure — read the manufactured part back

```jsonc
engineering.inspect_mesh { path: "bracket.stl" }
// → volume 73 548 mm³, watertight true, bbox 50 × 140 × 12, mass 0.577 kg
```

### 5. tolerance — the bore ↔ shaft fit

```jsonc
engineering.calc { kind: "iso_fit", args: { nominal: 25, hole: "H7", shaft: "g6" } }
// → clearance fit, 7–41 µm guaranteed clearance (the shaft always fits, runs freely)
```

**The loop is closed:** the load sets the thickness, the thickness is what the
model is built with, the model's measured volume and mass match the design, and
the bore the model cut is the one the fit sizes.

## Second example — a single-stage gear reducer (transmission tools compose)

The bracket proves the STATICS lane composes; a gear reducer proves the
POWER-TRANSMISSION lane does too. A 3 kW motor at 1500 rpm through a 3:1 stage:

```jsonc
engineering.calc { kind: "gear_train",  args: { stages: [{ driver: 20, driven: 60 }], inputSpeed_rpm: 1500, inputTorque_Nm: 19.1 } }
// → train value 3, output 500 rpm, output torque 57.3 N·m  (agrees with gear_pair)
engineering.calc { kind: "shaft_torsion", args: { torque: 57296, diameter: 20 } }   // → τ 36.5 MPa (< 40 allowable)
engineering.model_3d { part: "helical_gear", spec: { teeth: 60, module: 3, faceWidth: 30, boreDiameter: 20, helixAngleDeg: 15 } }
engineering.calc { kind: "bearing_life",  args: { dynamicLoadRating: 20000, equivalentLoad: 677, bearingType: "ball", speed_rpm: 500 } }
```

The seams: the two gear tools agree on the ratio; the output torque the reduction
produces is what the shaft is sized for; the shaft diameter (20) is the gear bore
and the bearing bore; the gear's tooth force is the bearing's radial load.

## Proofs

- `npm run smoke:engineering-workflow-integration` — the bracket, chaining the
  pure cores with 20 cross-core assertions (statics: load → thickness → model →
  measure → fit).
- `npm run smoke:engineering-gearbox-integration` — the gear reducer, 16
  cross-core assertions (transmission: torque → reduction → shaft → gear → bearing).
- `npm run drill:engineering-workflow-e2e` — designs → models → **builds in real
  Blender** → measures the bracket, confirming the manufactured volume, mass, and
  bounding box match the design (5 live steps, 577 g designed = 577 g measured).

## Tool inventory (quick reference)

| Tool | What |
|---|---|
| `engineering.calc` | ~35 kinds: statics (beam, sections, buckling, torsion, thermal, pressure), dynamics (natural/damped vibration), kinematics (four_bar, crank_slider, grashof), fluids (pipe_flow), heat (conduction, convection, composite_wall), machine elements (spring_rate, gear_pair, gear_train, power_screw, belt_drive, bearing_life, bolt_preload, tap_drill), manufacturing (iso_fit, tolerance_stack), electrical (ohms_law, led_resistor, rc, …), materials, unit convert |
| `engineering.model_3d` | ~20 parts: plate/bracket/tube/flange, gear/gear_pair/helical_gear/rack, extrude/revolve/pulley, spring/thread/bolt/nut, beam/frame, elbow, cam, sheet_metal, custom |
| `engineering.draft_dxf` | floorplan / schematic / boltcircle / gear / gear_pair / custom |
| `engineering.inspect_mesh` | measure a part: bbox, volume, watertight, mass |
