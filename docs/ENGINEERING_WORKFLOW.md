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

## One-call packaged designers (`engineering.design_part`)

The chains above — and the five wave-6 composition drills — are packaged as
one-call designers: state the DUTY, get back a sized, stock-rounded,
re-checked part. Every designer rounds a required dimension UP to a standard
size and re-checks the realised stress/life/isolation at that size, so the
returned part meets the duty, not just the raw requirement. Honest refusal is
a first-class output (uncoolable brake, un-isolatable low-frequency duty).

| `type` | duty inputs | what comes back |
|---|---|---|
| `bracket` | load, arm | plate t by bending, bolt holes, H7/g6 bore fit |
| `shaft` | torque | Ø by τ=16T/πd³ |
| `beam` | load, span, section | I/channel section sized by M/Sx |
| `gearbox` | power_kW, inputSpeed_rpm, ratio | module/teeth by Lewis, shaft by combined-load capstone (static+fatigue), key, required bearing C, gear-pair bpy |
| `isolator` | mass_kg, speed_rpm (or disturbanceFrequency_Hz), isolationPercent | spring set d/D/n via transmissibility; realised isolation never undershoots (rounding errs soft) |
| `pressure_cover` | pressure_MPa, boreDiameter_mm | wall (thin-wall sizes, Lamé re-checks/governs), cover by plate bending, flange bolt count/size with separation margin |
| `conveyor_drive` | power_kW, inputSpeed_rpm, ratio | ANSI chain pitch (table step asserted), exact integer ratio, head shaft, key, bearing C |
| `brake` | torque_Nm, speed_rpm, dutyCycle | disc by uniform-wear, clamp force vs lining pressure, fin count to shed T·ω (or ok:false with the shortfall) |

Designer smokes verify by ROUND-TRIP (returned dims fed back into the source
lanes must clear their targets) and by drill regression (the gearbox designer
configured with the drill's inputs reproduces the drill's numbers exactly):
`smoke:engineering-design-core` (routing, all 8 types) plus one deep smoke per
designer — `-gearbox` (71), `-isolator` (72), `-pressure-cover` (72),
`-conveyor-drive` (69), `-brake` (65).

## Proofs

- `npm run smoke:engineering-workflow-integration` — the bracket, chaining the
  pure cores with 20 cross-core assertions (statics: load → thickness → model →
  measure → fit).
- `npm run smoke:engineering-gearbox-integration` — the gear reducer, 16
  cross-core assertions (transmission: torque → reduction → shaft → gear → bearing).
- `npm run smoke:engineering-cooling-integration` — a liquid-cooled cold plate, 14
  cross-core assertions (thermal + fluid: dissipation → composite_wall resistance
  network → junction temp within budget → pipe_flow coolant loop → thermal_expansion
  → plate mass). One aluminium supplies both the conduction k and the growth α.
- `npm run smoke:engineering-gearbox-design-integration` — a single-reduction gearbox,
  **48 cross-core seams**: the gear force sizes the shaft (combined bending+torsion
  capstone), the torque sizes the key, the reaction sizes the bearing — one force read
  many ways. Shows the shaft-design lane is the confluence (T=0 → pure bending Sy/n).
- `npm run smoke:engineering-pressure-cover-integration` — a bolted pressure-vessel end,
  ~22 seams: one pressure p splits the wall (thick_cylinder Lamé), bends the cover
  (plate_bending), and its end load p·π·a² is the tension the flange bolts clamp
  (bolted-joint diagram — separation + fatigue). Flange bolts carry tension, not shear.
- `npm run smoke:engineering-vibration-isolation-integration` — a machine mount,
  ~17 seams: target transmissibility → required ωn → mount stiffness k → spring geometry,
  the loop closing back through √(k/m); static deflection δ=g/ωn² agrees three ways. The
  tuned absorber is shown as the single-frequency alternative (X1→0 at tuning).
- `npm run smoke:engineering-conveyor-drive-integration` — a chain conveyor drive,
  ~15 seams: the chain's exact ratio hits the target speed a slipping belt misses; the
  one chain tension both bends the shaft and loads the bearing → chain → shaft → key → L10.
- `npm run smoke:engineering-brake-cooling-integration` — a finned brake, 29 seams across
  the mechanical→thermal boundary: the brake torque becomes heat, P_heat=T·ω, and the fin
  array must shed exactly that (N·Q ≥ P_heat); fins pay off only because bare-drum
  convection is the bottleneck (effectiveness > 1).
- `npm run drill:engineering-workflow-e2e` — designs → models → **builds in real
  Blender** → measures the bracket, confirming the manufactured volume, mass, and
  bounding box match the design (5 live steps, 577 g designed = 577 g measured).

## Tool inventory (quick reference)

| Tool | What |
|---|---|
| `engineering.calc` | ~75 kinds: statics (beam, sections, buckling [Euler+Johnson], eccentric_column, torsion, thermal, pressure [thin + thick_cylinder Lamé], plate_bending), combined stress (principal_stress, von_mises, max_shear, stress_concentration), failure (fatigue endurance/goodman/life, notch_fatigue), dynamics (natural/damped/forced vibration, vibration_isolation, vibration_absorber), kinematics (four_bar, crank_slider, grashof), fluids (pipe_flow, journal_bearing), heat (conduction, convection, composite_wall, fin_heat), machine elements (spring_rate, spring types, gear_pair/train/strength, worm_gear, bevel_gear, power_screw, belt_drive, chain_drive, bearing_life, shaft_diameter/fatigue, key_sizing, friction_clutch, band_brake, flywheel, hydraulic_cylinder), joints (bolt_preload, fillet_weld, bolt_group[_eccentric], bolt_bearing, joint_stiffness, bolt_fatigue, riveted_joint), structures (truss), manufacturing (iso_fit, tolerance_stack, tap_drill), contact (contact_stress, press_fit), electrical (ohms_law, led_resistor, rc, …), materials, unit convert |
| `engineering.model_3d` | ~20 parts: plate/bracket/tube/flange, gear/gear_pair/helical_gear/rack, extrude/revolve/pulley, spring/thread/bolt/nut, beam/frame, elbow, cam, sheet_metal, custom |
| `engineering.draft_dxf` | floorplan / schematic / boltcircle / gear / gear_pair / custom |
| `engineering.inspect_mesh` | measure a part: bbox, volume, watertight, mass |
