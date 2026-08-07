# CLAUDE.md - The Underground Circle

> Project context for Claude Code, OpenSwan, Codex, Gemini, and other agents.
> Last reviewed: 2026-08-06

Start with `AGENTS.md`. `docs/AGENTS_ROADMAP.md` is canonical for ownership,
phase status, SQL status, and runtime rules. This file is a current app review
and orientation guide.

## Product

The Underground Circle is a shared AI-agent accountability workspace for small
dev teams. The core loop is:

`connect repo/providers -> plan and run work in Chat/Office/Feed -> agents
execute with tools -> proof, activity, memory, and follow-up become visible`.

Priority remains:

1. GitHub/team accountability.
2. BlackSwan/OpenSwan as the shared agent layer.
3. Reliable provider routing, memory, approvals, and observability.
4. Computer Use and local desktop actions with explicit gates.

Wallet, games, training experiments, and decorative office work are secondary
unless they strengthen the accountability loop.

## Stack

| Layer | Current reality |
|---|---|
| Frontend | Expo 54, React Native 0.81.5, React 19, React Native Web |
| Language | TypeScript |
| Backend | Supabase Auth, Postgres, Realtime, Edge Functions |
| Web deploy | Netlify |
| Runtime | BlackSwan/OpenSwan, Claude Code/Codex bridges, Browserbase Computer Use |
| LLM routing | `llm-proxy`, `swanbot-ai`, `swanbot-v2-ai`, provider marketplace, BYOK |
| Local bridges | app dev server 8081, OpenSwan proxy 18790, Claude bridge 7778 |

Production JavaScript uses `max-age=0, must-revalidate`, not immutable
caching. Expo/Metro may retain a parent chunk name while changing its lazy
module graph, so a stale entry chunk can otherwise load incompatible children.
Content-addressed assets may remain immutable.

Core commands:

```bash
npm run web
npm run start
npm run build
npm run typecheck
npm run proxy
npm run bridge
```

## App Surfaces

- Chat: main agent surface, model picker, chat automation, computer task
  routing, memory references, artifacts, threads, and persisted bot metadata.
- Office: live agent dashboard, local bridge visibility, activity feed,
  terminal, controls, memory/run panels, approvals, and agent identity.
- Feed: goals, plans, missions, tasks, proof of work, and team operating loop.
- Rooms: project rooms, files, services, room chat, task execution, playground.
- Marketplace: user/circle integrations, provider keys, model/provider catalog,
  browser/computer providers, and billing preference.
- Computer Use: Browserbase runtime plus local desktop and browser bridge tools.

## Runtime Map

Canonical owners are in `docs/AGENTS_ROADMAP.md`; this is the practical map:

| Concern | Owner |
|---|---|
| Chat planning | `src/lib/chatAutomationPlanner.ts` |
| Chat computer/app request routing | `src/lib/chatComputerRequestRouter.ts` |
| Chat computer/app user notices | `src/lib/chatComputerRequestUx.ts` |
| Computer task evidence contract | `src/lib/computerTaskEvidenceContract.ts`, `src/lib/computerTaskEvidenceRecovery.ts` |
| Chat execution | `src/lib/runChatAutomationPlan.ts`, `src/lib/chatAgentContextPack.ts` |
| Chat transcript and thread lifecycle | `src/screens/circles/tabs/ChatTab.tsx`, `src/screens/circles/tabs/chat/ChatThreadSidebar.tsx`, `src/screens/circles/tabs/chat/ChatThreadHeader.tsx`, `src/lib/chatService.ts`, `src/lib/chatMessageShape.ts`, `src/lib/circleChatThreads.ts`, `src/lib/chatComposerDraftCore.ts`, `src/lib/subscribeWithReconnect.ts` |
| Chat thread/message database authority | `supabase/migrations/20260805_messages_thread_rls_and_reactions.sql`, `docs/RUN_THIS_SQL.sql` §31, `scripts/messages-thread-rls-smoketest.ts` |
| BlackSwan response path | `src/lib/swanbot.ts`, `src/lib/swanbotClientToolDispatcher.ts`, `supabase/functions/swanbot-ai/index.ts` |
| v2 SwanBot tool loop | `supabase/functions/swanbot-v2-ai/index.ts`, `supabase/functions/_shared/swanbot-continuation.ts`, `supabase/functions/_shared/swanbot-continuation-crypto.ts`, `src/lib/swanbotV2BatchRuntime.ts`, `src/lib/swanbotV2BatchPolicy.ts`, `src/lib/swanbotV2ClientLoopFlag.ts` |
| SwanBot continuation checkpoint privacy | `supabase/functions/_shared/swanbot-continuation-crypto.ts`, `supabase/functions/swanbot-v2-ai/index.ts`, `supabase/migrations/20260726_swanbot_continuation_privacy.sql`, `docs/RUN_THIS_SQL.sql` §29 |
| SwanBot/OpenSwan production readiness | `src/lib/swanbotOpenSwanReadiness.ts`, `scripts/swanbot-openswan-readiness-report.ts`, `supabase/migrations/20260805_openswan_production_readiness_contract.sql`, `docs/RUN_THIS_SQL.sql` §32 |
| Typed model/tool loop | `src/lib/agentExecutionCore.ts` |
| OpenSwan sessions | `src/lib/openswanSessionRuntime.ts` |
| Agent subject identity | `src/lib/agentRuntimeSubject.ts`, `src/lib/agentIdentityKey.ts`, `src/lib/agentIdentity.ts` |
| Tool catalog | `src/lib/openswanToolRuntime.ts` |
| Provider profile model choice | `src/lib/serviceProfileSouls.ts` |
| Cross-provider fallback | `src/lib/crossProviderRouter.ts`, `src/lib/universalInvoke.ts` |
| Billing preference | `src/lib/billingPriority.ts` |
| BlackSwan model routing | `src/lib/blackswanRouting.ts` |
| Computer task runtime, exact programs, and truthful Chat lane outcomes | `src/lib/computerTaskRuntime.ts`, `src/lib/computerSequenceProgramCore.ts`, `src/lib/computerTaskOutcome.ts`, `src/lib/chatLaneOutcome.ts`, `src/screens/circles/tabs/ChatTab.tsx` |
| Browser computer use and typed mutation handoffs | `src/lib/computerUseAgent.ts`, `src/lib/useComputerUseTask.ts`, `src/lib/useComputerUseQueue.ts`, `supabase/functions/computer-use-agent/index.ts`, `src/lib/computerUse.ts`; cloud starts require a bounded v1 policy, while all legacy recorder mutations remain value-stripped typed OpenSwan handoffs |
| Local desktop intent | `src/lib/localComputerAwarenessIntent.ts` |
| Desktop bridge authentication boundary | `scripts/desktop-bridge-security.js`, all four local agent bridge servers, `src/lib/bridgeAuth.ts`, `src/lib/desktopBridge.ts` |
| App observation epochs and mutation receipts | `src/lib/computerAppGrounding.ts` |
| Unfamiliar-app semantic workflow | `src/lib/genericAppNavigator.ts` (`buildGenericAppSemanticWorkflow`) |
| Guarded browser mutation canaries | typed `browser.fill_field`, `browser.set_toggle`, and `browser.select_option` in `src/lib/openswanToolRuntime.ts`, `src/lib/browserBridge.ts`, `scripts/browser-bridge.js` |
| Identity-bound semantic browser barriers | typed `browser.wait_for` and `browser.scroll` in `src/lib/browserPrimitives.ts`, `src/lib/browserBridge.ts`, `src/lib/openswanToolRuntime.ts`, `src/lib/swanbot.ts`, `supabase/functions/swanbot-v2-ai/index.ts` |
| Narrow native semantic-press canary | typed `desktop.click_element` in `src/lib/openswanToolRuntime.ts`, `src/lib/computerAppAdapter.ts`, `src/lib/desktopBridge.ts` |
| Sealed native semantic-value lane | typed `desktop.set_element_value` in `src/lib/openswanToolRuntime.ts`, `src/lib/computerAppAdapter.ts`, `src/lib/desktopBridge.ts`, `scripts/claude-bridge.js` |
| Durable exact action-call ledger | `src/lib/agentActionCalls.ts`, `supabase/migrations/20260726_agent_action_calls.sql`, `docs/RUN_THIS_SQL.sql` §26 |
| Exact single-use approval authority | `src/lib/chatApprovalGate.ts`, `src/lib/openswanToolApprovals.ts`, `src/lib/openswanToolRuntime.ts`, `src/lib/swanbot.ts`, `supabase/migrations/20260726_database_authority_guards.sql` / `docs/RUN_THIS_SQL.sql` §28 |
| Scheduled external-action authority | `src/lib/scheduledActions.ts`, `supabase/functions/scheduled-action-runner/index.ts`, `supabase/migrations/20260726_scheduled_action_mutation_guard.sql` |
| Office durable command authority | `src/lib/officeTerminal.ts`, `src/screens/circles/tabs/OfficeTab.tsx`, `supabase/migrations/20260726_database_authority_guards.sql` / `docs/RUN_THIS_SQL.sql` §28 |
| WordPress/Dealer Inspire admin automation | `src/lib/wpAdmin.ts`, `src/lib/computerAppTaskStrategy.ts`, `src/lib/chatComputerRequestRouter.ts`, `src/lib/userTaskPipelines.ts`, `src/lib/wordpressAdminSourceIntelligence.ts` |
| Design creative AI | `src/lib/designAppCreativeAi.ts` |
| Design execution pipeline | `src/lib/designAppExecutionPipeline.ts` |
| Photoshop ExtendScript adapters | `src/lib/photoshopExtendScriptAdapters.ts` (LOCKSTEP: `scripts/claude-bridge.js`) |
| Local CAD execution | `src/lib/cadCodeExecutor.ts`, `src/lib/cadFileInspector.ts`, `desktop.cad_compile` |
| Engineering WORKFLOW (how the tools compose) | `docs/ENGINEERING_WORKFLOW.md` — the canonical loop `size (calc) → draw (draft_dxf) → model (model_3d) → measure (inspect_mesh) → tolerance (iso_fit/stack)`, walked on a worked cantilever-bracket example with real tool calls. Proven to compose: `npm run smoke:engineering-workflow-integration` chains the pure cores (20 cross-core assertions — the section modulus the geometry gives is consumed by the stress calc; the load-sized thickness is what the model is built with; the bore the model cuts is what the fit sizes) and `npm run drill:engineering-workflow-e2e` designs→models→builds-in-Blender→measures the bracket (volume/mass/bbox match design to 0.02%). Start here to USE the suite as a pipeline, not a pile of tools. ONE-CALL: `engineering.design_part` (`src/lib/engineeringDesignCore.ts`) packages the whole pipeline — give it a duty ({type:bracket/shaft/beam, load/torque/arm/span, material, safetyFactor}) and it sizes the member (round-up + re-check), emits a ready-to-compile bpy, and returns the mass, realised safety factor, and bore fit. `smoke:engineering-design-core` pins the recipes (bracket = the workflow integration chain). Wave 7 packages the five wave-6 composition drills as designers too — `gearbox`/`isolator`/`pressure_cover`/`conveyor_drive`/`brake` in `src/lib/engineeringDesign{Gearbox,Isolator,PressureCover,ConveyorDrive,Brake}Core.ts` (each rounds to stock + re-checks; honest ok:false refusal for uncoolable/un-isolatable duties); smokes verify by ROUND-TRIP (returned dims fed back into source lanes) + drill regression, `smoke:engineering-design-{gearbox,isolator,pressure-cover,conveyor-drive,brake}` (71/72/72/69/65) |
| Engine-neutral CAD drafting (DXF generation) | `src/lib/engineeringDraftingCore.ts` (pure DXF R12 writer/parser + floor-plan/schematic/grid generators), tool `engineering.draft_dxf` (pure computation, no app); the SAME neutral entity model compiles to AutoCAD `.scr` via `src/lib/autocadScriptAdapter.ts` `draft_entities` (execution gated on real-install verify). Cross-implementation proven by `scripts/dxf-verify.py` + `npm run drill:engineering-drafting`. `buildBoltCircle` adds flange/hole-pattern drawings; `engineeringDimensionCore.ts` + `annotateDrawing` add overall dimensions + title block (`titleBlock`/`autoDimension` args) — dimension TEXT is the MEASURED distance (a dim that lies = cut-the-wrong-part), asserted `text===formatDim(measured)`; verifier bbox expands CIRCLE/ARC by radius |
| Engine-neutral 3D solid modeling | `src/lib/engineeringSolidModelingCore.ts` (pure neutral CSG model → Blender bpy + OpenSCAD emitters + plate/bracket/tube/**flange** generators + `boltCirclePoints`), tool `engineering.model_3d` (pure computation); runs on the live-proven `desktop.cad_compile` blender lane → STL. Dimensionally proven end to end by `scripts/stl-verify.py` + `npm run drill:engineering-solid` (real Blender build → independent STL bbox check; flange = disc+bore+6-hole bolt circle → 2088 triangles at 120×120×12mm) |
| Engineering analysis (calculations) | `src/lib/engineeringCalcCore.ts` (pure: beam deflection/stress, section properties, column buckling Euler Pcr=π²EI/(KL)², shaft torsion τ=16T/πD³ + θ=TL/GJ, thermal expansion ΔL=αLΔT + restrained stress EαΔT, thin-wall pressure vessel σ_hoop=pr/t, spring rate k=G·d⁴/(8D³n), gear-pair transmission, bolt/thread, Ohm/LED/RC, unit conversion, materials with E + shear modulus G + thermal α), tool `engineering.calc` (kinds incl. `column_buckling`/`shaft_torsion`/`thermal_expansion`/`pressure_vessel`/`spring_rate`). Buckling composes the structural-section Iₓ; torsion composes materials G; thermal composes materials α. Textbook-exact — every formula asserted against a hand-computed reference in `scripts/engineering-calc-core-smoketest.ts` (the smoke IS the proof, no app). Sizes a part before `engineering.draft_dxf`/`engineering.model_3d` draw it |
| Rolling-bearing life (L10) | `src/lib/engineeringBearingCore.ts` (pure: `bearingLife` L10=(C/P)^p million rev, p=3 ball / 10/3 roller; equivalent load P=X·Fr+Y·Fa; L10h=L10·1e6/60n; ISO 281 reliability factor a1 for 90–99.95%). Pairs with the shaft lane (shaft carries torque, bearing carries the reaction loads). `engineering.calc` kind `bearing_life`. The steep power law is the point — halving the load × 8 the life, a 26% overload halves it. Textbook-pinned: C=25.5kN/P=5kN/ball → 132.65 Mrev, 1474 h @1500rpm; 99% reliability ×0.25. Smoke `engineering-bearing-core` IS the proof |
| Belt / pulley drives | `src/lib/engineeringBeltDriveCore.ts` (pure, composes the V-groove pulley: `beltDrive` speed ratio D₁/D₂, open-belt length L=2C+(π/2)(D+d)+(D−d)²/4C, wrap angles π∓2asin((D−d)/2C), capstan tension ratio T1/T2=e^(μθ) with V-belt wedge f=μ/sinβ, transmissible power (T1−T2)·V). `engineering.calc` kind `belt_drive`. The small pulley wraps least → slips first → sets capacity. Textbook-pinned: 100/200 pulleys @400 C → ratio 0.5, belt 1277.5mm, wrap 165.6° (+194.4°=360°), belt speed π·D₁·n₁; V-belt grips 3×+ a flat belt. Smoke `engineering-belt-drive-core` IS the proof |
| Power screws / lead screws | `src/lib/engineeringPowerScrewCore.ts` (pure, composes the ISO thread: `powerScrew` unwraps one turn into an inclined plane of lead angle λ=atan(l/πdm), raise torque T=(F·dm/2)(l+πf·dm)/(πdm−f·l), lower torque, efficiency η=Fl/2πT, self-locking test f>tanλ, collar torque; effective friction f=μ/cos(half-angle) so a V-thread wedges). Name an M-size → pitch diameter + coarse pitch supply dm + lead. `engineering.calc` kind `power_screw` (square/acme/iso forms, starts, collar). Textbook-pinned: dm=25/lead=5/μ=0.15/F=6000 → T=16.18 N·m, η=29.5%, self-locking; a fast lead screw back-drives. Smoke `engineering-power-screw-core` IS the proof |
| Mechanism kinematics (linkages) | `src/lib/engineeringKinematicsCore.ts` (pure: `grashof` classification s+l vs p+q + shortest-link position → crank-rocker/double-crank/double-rocker/non-Grashof; `fourBarPosition` Freudenstein output angle + coupler + transmission angle, VERIFIED by the loop-closure residual (crank-tip↔rocker-tip distance must equal the coupler); `crankSlider` piston x=r·cosθ+√(l²−r²sin²θ), stroke 2r, TDC/BDC, velocity). Analysis partner to the cam/rack motion geometry. `engineering.calc` kinds `four_bar` + `crank_slider` + `grashof`. Verified by SELF-CHECK not memorised angles: four-bar loop residual ≈0 at every input angle & both circuits. Textbook-pinned: slider TDC=r+l/BDC=l−r/mid=√(l²−r²). Smoke `engineering-kinematics-core` IS the proof |
| Heat transfer (thermal flow) | `src/lib/engineeringThermalCore.ts` (pure, imports MATERIALS which now carry thermal conductivity k: `conduction` Q=kAΔT/L + R=L/kA; `convection` Q=hAΔT + R=1/hA; `compositeWall` series thermal-resistance network + optional surface films → total R, heat rate, U-value, every interface temperature). The unifying idea = Ohm's law with ΔT as voltage, Q as current, so a layered wall is resistances IN SERIES. `engineering.calc` kinds `conduction` + `convection` + `composite_wall`. Composes materials k. Textbook-pinned: k=50 wall Q=50kW/R=0.002; h=25 convection Q=2000W; composite Q=ΔT/ΣR with insulation dominating (R≫ metal skin) + interface temps hot→cold. Smoke `engineering-thermal-core` IS the proof |
| Mechanical vibration (dynamics) | `src/lib/engineeringVibrationCore.ts` (pure, SI-internal: `naturalFrequency` ωn=√(k/m) OR √(g/δ) from static deflection — the two faces of one fact, k/m=g/δ; `dampedVibration` ζ=c/2√(km), critical damping cc=2√(km), damped ωd=ωn√(1−ζ²), under/critical/over classification, log decrement 2πζ/√(1−ζ²)). Composes spring rate k AND beam deflection δ. `engineering.calc` kinds `natural_frequency` + `damped_vibration` (stiffness N/m or springRate N/mm, mass kg, damping N·s/m or ratio). Textbook-pinned: k=1000/m=1 → fn=5.033 Hz; δ=1mm → fn=15.76 Hz (both faces agree); ζ=0.158 underdamped. Smoke `engineering-vibration-core` IS the proof |
| Pipe hydraulics (fluid flow) | `src/lib/engineeringFluidCore.ts` (pure, SI-internal: `FLUIDS` table ρ/μ, `reynoldsNumber` ρVD/μ, `frictionFactor` laminar 64/Re + turbulent Swamee–Jain, `pipeFlow` → Re, regime, f, Darcy–Weisbach head loss + Δp, continuity Q=VA). `engineering.calc` kind `pipe_flow` (diameter mm, velocity or flowRate, length, fluid, roughness). Composes the pipe/elbow bore. Unit discipline: convert mm/L-min → SI base at the boundary, physics factor-free. Textbook-pinned: water@2m/s@Ø50 → Re=99,601 turbulent; laminar f=64/Re EXACT; turbulent Swamee–Jain cross-checked vs Blasius 0.316/Re^0.25 within a few %; Δp=ρg·h_f consistent. Smoke `engineering-fluid-core` IS the proof |
| Manufacturing tolerances (ISO 286 fits + stack-up) | `src/lib/engineeringToleranceCore.ts` (pure: published IT5–IT11 grade table × 13 size ranges, hole `H` + shaft `h/g/f/k` fundamental-deviation formulas, `isoFit('H7','g6')` → limits + clearance/interference + fit type, `fitClearanceExplicit` for any deviations, `toleranceStackup` worst-case Σ\|tol\| + statistical RSS √Σtol² + largest contributor). `engineering.calc` kinds `iso_fit` + `tolerance_stack`. Closes the drafting dimension → manufacturable-part loop. Textbook-pinned: Ø50 H7/g6 = 9–50 µm clearance, Ø10 g6 = −5/−14, IT7@Ø10 = 15 µm (table, not round(16i)); stack RSS < worst-case. Smoke `engineering-tolerance-core` IS the proof |
| Engineering mesh inspection (measure a part) | `src/lib/engineeringMeshInspectCore.ts` (pure: binary-STL parse, bbox, volume via divergence theorem, surface area, watertight manifold check, mass), tool `engineering.inspect_mesh` (reads STL via new grant-gated `desktop.file_read_binary` base64 endpoint + `readFileBinary`). The measure-a-part partner to `engineering.model_3d`. MUTUAL-verified: `npm run drill:engineering-mesh-inspect` builds a part of known analytical volume in Blender then measures it back — plate agreed to 0.00%, flange 0.16% — so generator and inspector prove each other |
| Involute spur gears | `src/lib/engineeringGearCore.ts` (pure: exact gear geometry PD/OD/root/base, involute tooth profile, 2D `buildSpurGearDrawing`, 3D `buildSpurGearBlenderScript` via bmesh extrude + EXACT bore boolean). Wired as `engineering.draft_dxf` drawing 'gear' + `engineering.model_3d` part 'gear'. LIVE mutual-proven: `npm run drill:engineering-gear` builds Z12/Z24/Z40 gears in Blender, mesh-measures OD = m·(N+2) to 0.02%, all watertight |
| Helical gears | `src/lib/engineeringHelicalGearCore.ts` (pure, REUSES `spurGearProfile`: the same involute cross-section twisted along the axis at a helix angle β; `helicalGearGeometry` twist θ=W·tanβ/r_pitch, lead πd/tanβ, handedness; `buildHelicalGearBlenderScript` twist-extrudes the profile (bmesh rotated layers bridged + n-gon caps) then EXACT-subtracts a straight bore). The most common real gear (quieter/smoother than spur, adds axial thrust the bearing lane sizes). `engineering.model_3d` part 'helical_gear'. Verified by CAVALIERI: twisting a fixed-area section is volume-invariant, so a helical gear's volume EXACTLY equals its spur gear's (profileArea−bore)·face, independent of β. LIVE `npm run drill:engineering-helical-gear`: 15°/30°/25° gears in Blender — measured volume = spur volume to 0.01%, the 15° & 30° gears measure 0.000% apart despite different twist, all watertight, OD=m(N+2) envelope exact |
| Gear pairs (assemblies) | `src/lib/engineeringGearTrainCore.ts` (pure: exact pair geometry — center distance m·(N₁+N₂)/2, ratio, TANGENT pitch circles, 0.25m clearance, mesh phase; 2D assembly `buildGearPairDrawing` with center-distance dim; 3D `buildGearPairBlenderScript` composing two positioned/phased/bored gear units). `engineering.model_3d` 'gear_pair' + `engineering.draft_dxf` 'gear_pair' + `engineering.calc` 'gear_pair' (ratio/torque/speed transform — analysis composes geometry) + `engineering.calc` 'gear_train' (`gearTrain` in calcCore: COMPOUND train value = Π(driven/driver) over N stages, idlers cancel — completes single-gear→pair→train). The suite's first ASSEMBLY. LIVE: `npm run drill:engineering-gear-train` builds 3:1 & 1:1 pairs in Blender, mesh-measures span = ra₁+C+ra₂ to 0.2%, both watertight |
| Gear rack (rack-and-pinion) | `src/lib/engineeringRackCore.ts` (pure: a rack is a gear of infinite radius so its involute teeth are exactly TRAPEZOIDAL — straight flanks at pressure angle φ; `rackGeometry` circular pitch π·m, addendum m/dedendum 1.25m, tip narrower than root; profile = base strip + N trapezoid teeth; `buildRackBlenderScript` EXTRUDES the profile by faceWidth via the profile-solid extruder — no boolean). Completes the gear family (mates the spur `gear` pinion of the same module). `engineering.model_3d` part 'rack'. Verified TWO independent ways: outline shoelace area = base-rect + N tooth-trapezoids (smoke), extrude volume = area·faceWidth (drill). LIVE `npm run drill:engineering-rack`: m2×6 & m3×4 racks in Blender — volume to 0.000%, watertight, length×height×face envelope exact, teeth wider at root than tip |
| Profile solids: extrude + revolve | `src/lib/engineeringProfileSolidCore.ts` (pure: polygon area/centroid, extrudeVolume=A·h, revolveVolume=2π·R̄·A Pappus; general `buildExtrudeBlenderScript` reusing the gear extrude unit; `buildRevolveBlenderScript` via Blender Screw modifier; turnkey V-groove `buildPulley`). Completes the modeling triad (CSG + extrude + revolve). `engineering.model_3d` parts 'extrude'/'revolve'/'pulley'. LIVE Pappus cross-check `npm run drill:engineering-profile-solid`: extrude L-section 0.00%, revolve tube 0.03%, pulley 0.03% vs analytical, all watertight — a 3rd independent volume method agreeing with the mesh |
| Helical solids: compression spring | `src/lib/engineeringHelixCore.ts` (pure: `helixPoints`, developed length n·√((2πR)²+p²), `springGeometry` pitch/OD/ID/index/active-coils + wire volume π(d/2)²·L; `buildSpringBlenderScript` via a POLY helix curve with circular bevel + `use_fill_caps` → watertight mesh). The helical class beyond pure revolution — the developed-length volume is the helical analogue of Pappus. `engineering.model_3d` part 'spring'; sizes the rate k=G·d⁴/(8D³n) via `engineering.calc` 'spring_rate' (materials now carry shear modulus G). LIVE `npm run drill:engineering-helix`: two springs in Blender, mesh-measured wire volume within 1.0% of developed-length (faceting-limited, converges up with bevel resolution), OD=D+d exact, free length exact, both watertight |
| ISO metric threaded fasteners | `src/lib/engineeringThreadCore.ts` (pure: `isoMetricThread` exact ISO diameters d2=d−0.6495P/d3=d−1.2269P, `ISO_COARSE_PITCH` M-series table, `threadedRodGeometry` turns/developed-length + minor/pitch/major cylinder volumes; `buildThreadedRodBlenderScript` builds the thread as a radial HEIGHTFIELD r(θ,z)=minor+threadHeight·tooth((z−θP/2π)/P) on ONE swept fan-capped tube — NO boolean). The second helical solid; composes with `engineering.calc` bolt/tap-drill (size an M8 → model the M8). `engineering.model_3d` part 'thread'. Verified by a rigorous BRACKET not a point: measured STL volume must lie in [minorCyl, majorCyl] and near pitchCyl. LIVE `npm run drill:engineering-thread`: M8×1.25 & M12×1.75 in Blender — watertight, volume in-bracket at −1% of pitch cylinder, OD=d and length exact. KEY: in-Blender manifold ≠ STL manifold (a boolean union of a separate rib read watertight in-memory but left non-manifold edges on the re-welded STL; the single swept heightfield has no union boundary) |
| Sheet-metal bending | `src/lib/engineeringSheetMetalCore.ts` (pure: `bendAllowance` BA=θ(R+K·t), `sheetMetalGeometry` folds a flange/bend sequence into TWO developed lengths — fabrication flat blank Σflanges+ΣBA (uses K) and geometric mid-surface Σflanges+Σθ(R+t/2) — plus area/volume/bbox; `bentProfilePolygon` thickens the folded centreline into a ±t/2 ribbon; `buildBentPartBlenderScript` EXTRUDES that ribbon by the width, reusing the profile-solid extruder — NO boolean). A new class beyond solids of revolution. `engineering.model_3d` part 'sheet_metal'. The two lengths differ by exactly Σθ·t·(0.5−K) — the shop cuts the K length, the solid weighs the mid-surface length. LIVE `npm run drill:engineering-sheet-metal`: 90° L-bracket & U-channel in Blender — volume = t·L_geo·width to 0.01%, watertight, predicted bbox exact |
| Structural steel sections + beams | `src/lib/engineeringStructuralSectionCore.ts` (pure: ONE verified primitive `sectionProperties(rects)` — A, centroid, Iₓ/Iy via parallel-axis over signed rectangles (holes = negative), Sₓ/Sy, rₓ/ry; named `iBeamSection`/`channelSection`/`angleSection` (doubly-sym / singly-sym / asymmetric) each a rectangle decomposition + outline polygon; `buildBeamBlenderScript` EXTRUDES the outline by length via the profile-solid extruder — NO boolean). The structural arm; composes `engineering.calc` beam (feed Iₓ/Sₓ → deflection δ=PL³/48EI, stress). `engineering.model_3d` part 'beam'. Independent area cross-check: outline shoelace = rectangle-sum A. LIVE `npm run drill:engineering-structural-section`: I-beam/channel/angle in Blender — volume = A·length to 0.000%, watertight, predicted bbox exact; section props textbook-pinned in smoke |
| Structural frames / weldments | `src/lib/engineeringFrameCore.ts` (pure: `FrameMember` {axis,length,width,depth,at} → box; `frameUnionVolume` EXACT by inclusion–exclusion (pairwise fast-path when no triple joints, full 2ⁿ for n≤16, else bracket); `frameGeometry` steel takeoff — union volume, member schedule, envelope, mass; `frameSolidModel`→box positives; turnkey `portalFrame`/`rectangularFrame`; `buildFrameBlenderScript` unions via the PROVEN CSG lane `writeBlenderSolidScript` — reuse, not a new mesh path). The structural ASSEMBLY (as gear pairs were the mechanical one). `engineering.model_3d` part 'frame'. Composes CSG + materials mass. LIVE `npm run drill:engineering-frame`: portal/rectangular/ladder frames in Blender — measured volume = inclusion–exclusion union to 0.000%, watertight, envelope exact |
| Hex fasteners (bolt + nut) | `src/lib/engineeringFastenerCore.ts` (pure: `HEX_ACROSS_FLATS` ISO 272 wrench-size table, `hexBoltGeometry`/`hexNutGeometry` closed-form volumes, `buildHexBoltBlenderScript` head∪shank, `buildHexNutBlenderScript` hex−bore — a hex prism is a 6-vertex Blender cylinder, unioned/subtracted with the EXACT solver). The recognizable fastener shapes atop the ISO thread. `engineering.model_3d` parts 'bolt'/'nut'. Volumes: bolt = hexArea·headH + shank − overlap; nut = hexArea·h − bore. LIVE `npm run drill:engineering-fastener`: M10/M16 bolts & nuts in Blender — volume to 0.1%, watertight, across-flats/across-corners/height envelope exact, nut bore confirmed present |
| Fatigue analysis (endurance + mean stress + life) | `src/lib/engineeringFatigueCore.ts` (pure: `enduranceLimit` Se=ka·kb·kc·Se', Se'=0.5·Su cap 700 with Marin surface/size/load derating + Su-from-yield flag; `goodmanSafetyFactor` 1/n=σa/Se+σm/Su plus Soderberg/Gerber/Langer; `fullyReversedLife` Basquin S=a·N^b with infinite/finite/low_cycle regimes). The static-pass-is-not-enough lane — a fluctuating stress under yield still cracks. `engineering.calc` kinds `endurance_limit`/`fatigue_goodman`/`fatigue_life`. NO build (fatigue is statistical material behaviour): the smoke IS the proof — 59 assertions pinned to Shigley reference values, every Marin factor + three mean-stress criteria + runout/finite/low-cycle boundaries |
| Bolted + welded connections | `src/lib/engineeringConnectionCore.ts` (pure: `filletWeld` throat=0.7071·leg carries load not the leg, capacity a·L·τ; `boltGroupShear` As=π/4·(d−0.9382p)² thread-root reusing `coarsePitchFor` from `engineeringThreadCore`, single/double shear; `bearingStress` σ=P/(d·t·n) projected; `boltGroupEccentric` elastic vector method J=Σ(x²+y²), critical bolt where direct⊕torsional shear ALIGN). The joint is where structures fail. `engineering.calc` kinds `fillet_weld`/`bolt_group`/`bolt_bearing`/`bolt_group_eccentric`. Smoke IS the proof — 47 assertions vs worked examples incl. the eccentric-group critical-bolt location |
| Hydraulic cylinders | `src/lib/engineeringCylinderCore.ts` (pure: `cylinderForce` extend p·π(bore/2)² vs retract annulus p·π(bore²−rod²)/4 + regen ratio φ; `cylinderSpeed` v=Q/A retract-faster; `rodBuckling` Euler Pcr=π²EI/(KL)² I=π·d⁴/64). Extend≠retract (rod steals area); rod buckles not crushes. `engineering.calc` kinds `hydraulic_cylinder`/`cylinder_speed`/`rod_buckling`. Smoke IS the proof — 41 assertions + the **F·v=p·Q power invariant** closed so the force lane and flow lane certify each other (two physics domains reconcile, like the geometry lanes' three-volume-method agreement) |
| Gear tooth strength (Lewis bending) | `src/lib/engineeringGearStrengthCore.ts` (pure: `tangentialLoad` Ft=T/r; `lewisBendingStress` σ=Ft/(F·m·Y) — a tooth is a cantilever beam; `sizeFaceWidth` inverse mode; `lewisFormFactor`+`LEWIS_Y` published table interpolated). The OTHER gear failure mode beside geometry — composes module/teeth/torque from the geometry+train lanes. `engineering.calc` kind `gear_strength` (mode tangential_load/stress/size_face_width). Smoke IS the proof — 43 assertions, tabulated Y (hard-coded like the ISO fit table), monotonicities + size↔check round-trip |
| Combined-stress state (Mohr + von Mises) | `src/lib/engineeringStressCore.ts` (pure: `principalStresses` Mohr σ1,2=(σx+σy)/2±√(((σx−σy)/2)²+τxy²)+θp; `vonMises` component form √(σx²−σxσy+σy²+3τxy²) AND principal form cross-checked; `maxShearStress` in-plane vs absolute-3D with hidden σ3=0 governing when σ1,σ2 share a sign). A single component stress lies under combined loading. `engineering.calc` kinds `principal_stress`/`von_mises`/`max_shear`. Smoke IS the proof — 46 assertions, and von Mises computed **two ways that must agree** proves the whole Mohr→vM chain for free |
| Stress concentration (Kt) + notch fatigue (Kf) | `src/lib/engineeringStressConcentrationCore.ts` — `stressConcentration` (Kirsch hole Kt=3 exact, finite-width Heywood/Roark net-section fit, Inglis elliptical Kt=1+2(a/b) with ρ=b²/a self-check, hard-coded Peterson/Shigley A-15 stepped-shaft chart table bilinearly interpolated for tension/bending/torsion) + `notchFatigue` (Peterson q=1/(1+a/r), Kf=1+q(Kt−1), Se_corrected=Se/Kf; a=0.025·(2070/Su)^1.8 from Su or MATERIALS 1.7·yield); `engineering.calc` kinds `stress_concentration`/`notch_fatigue`; composes the geometric Kt into fatigue and derates the endurance-limit lane. Smoke IS the proof — 83 assertions pinning the exact Kt=3 anchor two ways (Kirsch + Inglis circle), the two-path Inglis ρ-form self-check, table nodes/monotonicity/mode-ordering, and the load-bearing invariant Kf≤Kt with blunt→Kt / sharp→1 limits and Se_corrected<Se |
| Thick-walled cylinders (Lamé) + interference (press/shrink) fits | `src/lib/engineeringThickCylinderCore.ts` (pure: `thickCylinder` σr=A−B/r², σθ=A+B/r², A/B from pi/po at ri/ro — bore/outer hoop+radial, bore max shear=pi·ro²/(ro²−ri²), 3D von Mises, capped-end axial=A; `pressFit` diametral interference δ → contact pressure via the shrink-fit compliance δr=p·rc·[(1/Eo)((ro²+rc²)/(ro²−rc²)+νo)+(1/Ei)((rc²+ri²)/(rc²−ri²)−νi)], hub & shaft stresses through the SAME Lamé engine, holding torque T=µ·p·2π·rc²·L). `engineering.calc` kinds `thick_cylinder` + `press_fit`. COMPOSES pressure_vessel (its THIN-WALL limit t→0 reproduces σ=pr/t — cross-checked live against the pressure_vessel lane to 1.0%), iso_fit (consumes its interference δ), shaft_torsion (delivers the holding torque). Verified by EXACT BCs (σr=−pi at bore, −po at outer surface), the σr+σθ=2A radius-invariant, hand-computed Lamé/shrink-fit cases; smoke `engineering-thick-cylinder-core` (104 assertions) IS the proof; MATERIALS has no Poisson so ν defaults to 0.3 |
| Hertzian contact stress (bearings/gears/cams) | `src/lib/engineeringContactCore.ts` (pure: `contactStress` mode 'sphere'=point contact → a=(3FR/4E*)^(1/3), p_max=3F/2πa², δ=a²/R; mode 'cylinder'=line contact → b=√(4FR/πLE*), p_max=2F/πbL; reduced modulus 1/E*=(1−ν₁²)/E₁+(1−ν₂²)/E₂, effective radius 1/R=1/R₁+1/R₂ with R₂ omitted/∞=flat, R₂<0=concave race). The CONTACT failure mode UNDER the bearing-L10, involute-gear, and cam lanes — a ball on a race, a gear tooth flank, a cam roller all reduce to a Hertz contact; these elements fail by pitting/spalling, not by the gross bending/torsion the calc core sizes. `engineering.calc` kind `contact_stress`. Poisson ν absent from MATERIALS → input, default 0.3. EXACT-ratio anchors: sphere p_max/p_mean=3/2, cylinder=4/π; p_max∝F^(1/3) sub-linear so a 1 kN ball contact runs several GPa (~18× yield) yet survives (triaxial confinement). Smoke IS the proof — 82 assertions: two exact ratios, textbook two-steel-sphere + steel-roller hand-computed, sphere-on-flat = R₂→∞ limit, concave-race LOWERs p_max, F^(1/3)/F^(1/2) signature scaling, swap symmetry |
| Parallel-key sizing (keyed shaft-hub joint) | `src/lib/engineeringKeyCore.ts` (pure: `standardKeySize` hard-coded ISO 773/DIN 6885 w×h section table for a shaft Ø (w≈d/4 fallback); `keySizing` sizes the key by TWO failure modes off the surface force F=2T/d — SHEAR across w·L → L_shear=F/(w·τ_allow), and BEARING/crushing across (h/2)·L → L_bear=F/((h/2)·σ_bear_allow) — required length = max, larger mode governs, allowables 0.4·σy shear / 0.9·σy bearing or overrides; `keyTorqueCapacity` inverse). Composes shaft_torsion: the key is the deliberate WEAK LINK sized for the same torque so it shears/crushes before the shaft. `engineering.calc` kind `key_sizing`. Verified by the BALANCED-KEY anchor: a square key at σ_bear=2τ has L_shear=L_bear exactly, a rectangular key (w>h) then crushes by w/h; + table monotonicity + size↔capacity round-trip reproducing the design torque. Smoke `engineering-key-core` IS the proof (156 assertions) |
| Friction clutches & brakes (torque capacity) | `src/lib/engineeringClutchBrakeCore.ts` (pure: `discClutch` carries BOTH bounding models — uniform PRESSURE T=(2/3)μFn(ro³−ri³)/(ro²−ri²) new + uniform WEAR T=(1/2)μFn(ro+ri) worn-in, wear ALWAYS lower → the design torque; `bandBrake` = a CAPSTAN that REUSES the belt-drive law T1/T2=e^(μθ), torque (T1−T2)·rd; `coneClutch` = a V-WEDGE that REUSES the V-belt 1/sinα so T = flat-clutch T / sinα). The suite RECOGNISES ITS OWN PRIMITIVES — a band brake IS the belt capstan, a cone clutch IS the V-belt wedge. `engineering.calc` kinds `friction_clutch` (disc + cone via `type`) + `band_brake`. Verified by the uniform-wear<uniform-pressure DUALITY ordering, the thin-ring limit where both disc models converge to μFnR, the exact capstan cross-check (doubling wrap SQUARES the ratio), cone→disc as α→90°. Smoke `engineering-clutch-brake-core` IS the proof (94 assertions) |
| Intermediate & eccentric columns (Johnson + secant) | `src/lib/engineeringColumnCore.ts` (pure: `columnCritical` auto-selects EULER σcr=π²E/λ² when λ≥Cc else J.B. JOHNSON parabola σcr=Sy·[1−Sy·λ²/(4π²E)]; `eccentricColumn` SECANT σmax=(P/A)[1+(ec/k²)·sec((KL/2k)√(P/AE))]; exports `transitionSlenderness`/`eulerCriticalStress`/`johnsonCriticalStress`). The honest COMPLEMENT to calc-core `column_buckling` (Euler-only, over-predicts for stocky columns). Composes MATERIALS (E, yield) + the structural-section k=√(I/A) (accepts area+radiusOfGyration OR area+momentOfInertia OR round diameter). `engineering.calc` kinds `column_johnson` + `eccentric_column`. Verified by the TANGENCY anchor: Euler and Johnson meet at λ=Cc=√(2π²E/Sy) with EQUAL σcr=Sy/2 AND equal slope −2π²E/Cc³ — pinned from BOTH formulas (why the transition sits at Cc). Textbook-pinned (Shigley): steel λ=40→Johnson 237.3 MPa (Euler would say absurd 1233.7), λ=180→Euler 60.9; secant e→0→P/A, σmax→∞ as P→Pcr. Smoke `engineering-column-core` (92 assertions) IS the proof |
| Forced vibration + isolation (dynamics) | `src/lib/engineeringForcedVibrationCore.ts` (pure, COMPOSES the vibration core's ωn=√(k/m) and ζ=c/2√(km)): `forcedResponse` steady-state under F0·sin(ωt) — magnification M=1/√((1−r²)²+(2ζr)²), amplitude X=(F0/k)·M, phase φ=atan2(2ζr,1−r²), true peak at r=√(1−2ζ²), plus rotating-unbalance form M_r=r²·M; `transmissibility` TR=√(1+(2ζr)²)/√((1−r²)²+(2ζr)²), solves r for a target TR / isolation % → needed static deflection δ=g/ωn². `engineering.calc` kinds `forced_vibration` + `vibration_isolation`. Two exact anchors ARE the proof: resonance M(1)=1/(2ζ), and the √2 crossover TR=1 at r=√2 for EVERY ζ (isolate only above √2, and MORE damping there means WORSE TR). Smoke `engineering-forced-vibration-core` (106 assertions) IS the proof |
| Bolted-joint stiffness diagram + bolt fatigue | `src/lib/engineeringBoltedJointCore.ts` (pure: `jointStiffness` bolt spring kb=Ab·E/L (or shank+thread series) + members-as-frusta Shigley km=π·E·d·tan30°/(2·ln[5(L·t+0.5d)/(L·t+2.5d)]) → joint constant C=kb/(kb+km); `separationLoad` P0=Fi/(1−C); `boltFatigue` σa=C·ΔP/2At, σm=[Fi+C·ΣP/2]/At → standard AND preload-referenced Goodman nf=Se(Su−σi)/(Su·σa+Se(σm−σi))). The layer between `bolt_preload` and the fatigue core that explains WHY preload works: because members are stiffer than the bolt (km≫kb), C is small (~0.24) so the bolt feels only C·P of an external load — separation at Fi/(1−C), and bolt fatigue is far milder than the raw load range. `engineering.calc` kinds `joint_stiffness` + `bolt_fatigue`. Smoke IS the proof — 76 assertions, textbook Shigley M12 joint pinned + invariants (C=0.5 at kb=km, load-split C·P+(1−C)·P=P closes, Fm=0 at P0, stiffer-member→lower-C→better-fatigue) |
| Flywheel energy storage + speed-fluctuation sizing | `src/lib/engineeringFlywheelCore.ts` (pure: `flywheelInertia` disc I=½mr² / thin-rim I=mr² / annulus I=½m(ro²+ri²), mass from geometry×density or direct; `flywheelEnergy` the sizing relation ΔE=I·ωavg²·Cs solved every direction — required I=ΔE/(ωavg²·Cs), traded ΔE, or achieved Cs — plus KE=½Iωavg² and the ωmax/ωmin=ωavg(1±Cs/2) band; `flywheelStress` rim hoop σ=ρv²=ρ(ωr)² and size-independent burst v=√(σ_allow/ρ)). The ROTATING-INERTIA arm — a flywheel smooths shaft speed by trading KE. Composes MATERIALS density (mass, kg/mm³→kg/m³ for hoop stress) + yield; radii convert mm→m at the inertia/rim-speed boundary so I stays kg·m². `engineering.calc` kind `flywheel` (mode inertia/energy/stress). Anchored: at equal mass & radius a RIM stores exactly 2× a DISC's inertia (why flywheels are rims). Textbook-pinned — Shigley/Khurmi (Cs=0.0168), I∝1/Cs, KE∝ω² square law, burst-speed scale-invariance. Smoke `engineering-flywheel-core` (79 assertions) IS the proof |
| Spring types beyond compression (torsion/extension/Belleville) | `src/lib/engineeringSpringTypesCore.ts` (pure: `torsionSpring` — helical torsion spring works in wire BENDING so its angular rate k'=E·d⁴/(10.8·D·N) uses YOUNG'S modulus E + inner-fibre bending stress σ=Ki·32M/πd³; `extensionSpring` — same G-rate as compression k=G·d⁴/(8D³n) BUT with INITIAL TENSION Fi so F=Fi+k·x and force≠0 at zero deflection; `belleville` — coned-disc Almen–Laszlo P=[4E/(K1(1−ν²)Do²)]·δ·[(h−δ/2)(h−δ)t+t³], NONLINEAR (cubic in δ), stacks parallel=+load/series=+deflection). `engineering.calc` kinds `torsion_spring`/`extension_spring`/`belleville`. Composes materials E+G. THE DUALITY: a torsion spring bends its wire (E) while a helical compression spring twists its wire (G) — same coil, different modulus (steel E≈2.5·G); Belleville h/t=√2 gives a constant-force plateau, h/t>√2 snaps through. Smoke `engineering-spring-types-core` IS the proof — 72 assertions, the E-vs-G duality pinned against the shipped compression `springRate` |
| Combined-load shaft design (bending + torsion, static + fatigue) | `src/lib/engineeringShaftDesignCore.ts` (pure, the CAPSTONE composing torsion+beam+stress+fatigue: `shaftDiameter` sizes a solid round shaft under simultaneous M+T by MAX-SHEAR-STRESS d³=(32n/πSy)·√(M²+T²) (equivalent moment Me=√(M²+T²)) AND DISTORTION-ENERGY d³=(32n/πSy)·√(M²+¾T²), reports both + stress state + which governs (MSST larger→conservative, DE≤MSST equal only at T=0); `shaftFatigue` the Shigley DE-Goodman rotating-shaft Eq. 7-8 d=((16n/π)·[√(4(Kf·Ma)²+3(Kfs·Ta)²)/Se+√(4(Kf·Mm)²+3(Kfs·Tm)²)/Sut])^(1/3) — 4-on-bending/3-on-torsion coefficients pinned to Shigley Ex 7-1 (n=1.614); `equivalentLoads` Me=½(M+√(M²+T²))/Te=√(M²+T²)). `engineering.calc` kinds `shaft_diameter`+`shaft_fatigue`. Composes MATERIALS (Sy). Verified by LIMITING CASES: T=0→pure bending σ=Sy/n, M=0→pure torsion τ=Sy/(2n) reproducing the shaft_torsion lane (smoke feeds d back into `shaftTorsion`/`sectionCircle`/stress-core `vonMises` and recovers 125/250/229.13); 87-assertion smoke IS the proof |
| 2D pin-jointed truss (method of joints) | `src/lib/engineeringTrussCore.ts` (pure: `solveTruss` writes the 2j joint-equilibrium equations ΣFx=ΣFy=0 — each member's axial force × its unit vector, TENSION +, plus pin/roller reactions + applied loads — into A·x=b and solves with an in-file dense GAUSSIAN ELIMINATION w/ partial pivoting (`solveLinearSystem`, no library); determinacy guard m+r vs 2j classifies mechanism (<) / determinate (=) / indeterminate (>), and a zero pivot ⇒ geometrically unstable even when the count is right; flags zero-force members; roller honours an incline angle). `engineering.calc` kind `truss`. VERIFIED BY the per-joint EQUILIBRIUM RESIDUAL exactly like the four-bar loop-closure residual — `jointResiduals` recomputes ΣF at every joint from the solved forces (independent of the assembly), must be ~0 (~1e-13), no answer key — plus global ΣFx/ΣFy/ΣM=0, two hand-worked textbook trusses (3-4-5 triangle; king-post zero-force post), Rule-1 zero-force detection, and the three determinacy/stability guards. Smoke `engineering-truss-core` (111 assertions) IS the proof |
| Worm-and-wheel drives | `src/lib/engineeringWormGearCore.ts` (pure: a worm IS a power screw meshing a wheel — same lead angle λ=atan(L/πdw), same self-locking λ<φ ⇔ f>tanλ; `wormGear` VR=Zg/Zw is a HUGE single-stage reduction (1-start/40-tooth=40:1), η=tanλ/tan(λ+φ) with the pressure-angle wedge f=μ/cos(φn) collapsing the full η EXACTLY, self-locking⇒η<½ clean fact (boundary (1−f²)/2), reverse η=tan(λ−φ)/tanλ≤0 ⇔ self-locking as an exact iff). `engineering.calc` kind `worm_gear`. Composes the power screw's inclined-plane physics wholesale (recognise-your-own-primitive, like rack=infinite-radius-gear, band-brake=capstan). Smoke `engineering-worm-gear-core` IS the proof — 72 assertions incl. the CROSS-CHECK that a power screw & worm at the same λ,f give the identical self-locking verdict + lead angle, η computed two ways agree to 15 sig-figs, VR pinned, textbook triple-start (Zw=3/Zg=30 → VR=10, λ=16.70°, η≈84.0%) |
| Tuned dynamic vibration absorber | `src/lib/engineeringVibrationAbsorberCore.ts` (pure: undamped 2-DOF Den Hartog absorber — primary m1/k1 driven by F0·sin(Ωt) gets absorber m2/k2; exact determinant D=(k1+k2−m1Ω²)(k2−m2Ω²)−k2², X1=F0(k2−m2Ω²)/D. THE TUNING: when ωa=√(k2/m2)=Ω the numerator vanishes so X1=0 exactly — the primary stands still and the absorber's spring force k2·X2=−F0 cancels the disturbance. COST: two new resonances (roots of D=0) that STRADDLE the original ωn=√(k1/m1), spacing=√μ when tuned to ωn — larger μ widens the safe band. Explicit / design / dimensionless modes; composes the vibration core's naturalFrequency for ωn & ωa). `engineering.calc` kind `vibration_absorber`. Smoke `engineering-vibration-absorber-core` (111 assertions): X1=0 & k2·X2=−F0 at tuning, the two-root straddle + √μ spacing, Den Hartog closed form, composition — IS the proof |
| Hydrodynamic journal (sleeve) bearing | `src/lib/engineeringJournalBearingCore.ts` (pure: `journalBearing` floats the shaft on an oil film — NO rolling elements; the Sommerfeld number S=(r/c)²·μN/P is the ONE dimensionless group governing everything; Petroff concentric friction f=2π²·(μN/P)·(r/c)=2π²·S·(c/r) is the clean analytic anchor and LOWER bound — pass a Raimondi–Boyd (r/c)f for the loaded case; friction torque Tf=f·W·r, power loss Tf·ω, min film h0=c(1−ε) with ε→1 = metal-to-metal failure). The FLUID-FILM complement to the rolling-element `bearing_life` lane; composes fluid viscosity (accepts Pa·s / SAE-grade `OILS` table / reyn). `engineering.calc` kind `journal_bearing`. RUTHLESS unit discipline (Pa·s, rev/s, Pa, reyn→×6894.757, rpm→/60) — S dimensionless proven by exact scaling, Petroff textbook-pinned (Shigley ch.12). Smoke `engineering-journal-bearing-core` IS the proof (78 assertions) |
| Straight bevel gears (angular drive, intersecting shafts) | `src/lib/engineeringBevelGearCore.ts` (pure, NO imports: `bevelGearPair` rolls two pitch CONES for shafts meeting at Σ — cone angles tan γ_p=sinΣ/(Ng/Np+cosΣ) with γ_p+γ_g=Σ (atan2, obtuse-safe), ratio Ng/Np=tan γ_g at 90°; TREDGOLD equivalent spur Ne=N/cosγ (>N always) develops the back cone so the Lewis strength lane applies to a bevel tooth; mean radius r_m=r_pitch−½F·sinγ; shared tangential Ft=T/r_m resolves to radial Wr=Ft·tanφ·cosγ + axial thrust Wa=Ft·tanφ·sinγ). COMPLETES the gear family (spur/helical/rack/worm were parallel-or-crossed) and composes the Lewis lane via Ne. `engineering.calc` kind `bevel_gear`. Verified four ways: cone-angle sum γ_p+γ_g=Σ (90° and 150° obtuse), cone distance r_pitch/sinγ agreeing from BOTH members (shared-apex self-check) = (m/2)√(Np²+Ng²) at 90°, Ne>N monotone in γ, the Σ=90° force-SWAP identity Wr(pinion)=Wa(gear) & Wa(pinion)=Wr(gear); textbook-pinned (Np20/Ng40/m4/φ20 → Ft=6007.5 N). Smoke `engineering-bevel-gear-core` (63 assertions) IS the proof |
| Roller chain drives | `src/lib/engineeringChainDriveCore.ts` (pure: `chainDrive` — sprocket PITCH DIAMETER PD=p/sin(180/N) is EXACT polygon geometry (N pins = an N-gon of side p, not a circle); ratio=N2/N1 EXACT because rollers positively engage (no belt slip); chain LENGTH L=2·Cp+(N1+N2)/2+((N2−N1)/2π)²/Cp rounded UP to an EVEN number of pitches (odd needs a weak offset link) then centre distance solved back via the Shigley quadratic; chordal/polygon speed ripple 1−cos(180/N) falls with tooth count, why ~17T is a floor; chain speed N1·p·n1, power P=F·V). Completes the gear/belt/chain transmission family — the positive-engagement sibling of the belt (exact ratio where the belt slips). `engineering.calc` kind `chain_drive`. Smoke IS the proof — 64 assertions: PD·sin(180/N)=p polygon identity at 7 N, 4-tooth square PD=p√2, polygon→circle limit, integer-exact ratios, both even-round branches + adjusted-centre round-trip, chordal 11T>17T>25T (17T~1.7%), F·V=P invariant |
| Flat plate bending (Roark, 2D analogue of a beam) | `src/lib/engineeringPlateBendingCore.ts` (pure: `platePressure` — flat plate under uniform pressure q. CIRCULAR uses exact ν-dependent Roark Table 11.2 — clamped σ_edge=0.75·q(a/t)², y=3q·a⁴(1−ν²)/(16E·t³); simply-supported σ_center=(3/8)(3+ν)·q(a/t)², y=3q·a⁴(1−ν)(5+ν)/(16E·t³). RECTANGULAR HARD-CODES the Roark Table 11.4 β/α table for a/b=1.0…2.0+∞ (like the ISO-286 IT-grade table) and interpolates: σ=β·q·b²/t², y=α·q·b⁴/(E·t³)). `engineering.calc` kind `plate_bending`. The 2-D analogue of the beam lane: σ∝(a/t)², y∝a⁴/t³; clamping is stiffer (~4× less deflection) but concentrates edge stress; as a/b→∞ the plate → a 1-D beam strip (β→0.75 SS / 0.5 clamped). Composes MATERIALS (E) + POISSON_RATIO. Smoke IS the proof — 82 assertions: scaling laws, clamped<SS deflection + clamped>SS edge stress, textbook-pinned, table monotonicity, the a/b→∞ strip limit tied to beam-strip theory |
| Extended-surface (fin) heat transfer | `src/lib/engineeringFinCore.ts` (pure: a fin is conduction ALONG the metal k·Ac fighting convection OFF its surface h·P, collapsing to one group m=√(hP/kAc); `finAnalysis` gives θ(x)/θb=cosh(m(L−x))/cosh(mL), heat rate Q=√(hPkAc)·θb·tanh(mL)=M·tanh(mL), efficiency η=tanh(mL)/mL, effectiveness ε=Q/(h·Ac·θb); rectangular/pin/custom shapes + convecting-tip corrected length Lc=L+Ac/P). The extended-surface partner to the thermal core — composes its conductivity k (MATERIALS) and film coefficient h. `engineering.calc` kind `fin_heat`. Smoke IS the proof — 75 assertions: η→1 as mL→0 (short/fat/high-k = ideal) and η→0 as mL→∞ (long tip is dead weight) + monotone, Q saturates with length, ε>2 justifies a fin and FALLS as h rises (a fin helps only when convection is the bottleneck), copper>aluminum>steel by k, textbook-pinned (Incropera/Cengel) |
| Riveted / bolted lap & butt joints (boiler seam) | `src/lib/engineeringRivetJointCore.ts` (pure: `rivetedJoint` sizes a seam per PITCH by three competing failure forces — plate TEARING Pt=σt(p−d)t across the net width, rivet SHEARING Ps=τ(π/4·d²)·n·planes, and CRUSHING Pc=σc·d·t·n on the projected area — the WEAKEST governs; solid-plate σt·p·t gives joint efficiency η=weakest/solid-plate, always in (0,1)). Adds the tearing mode + efficiency concept the bolt/weld `engineeringConnectionCore` lane lacked; shear planes = lap/single-cover-butt 1, double-cover-butt 2 (double shear doubles Ps). `engineering.calc` kind `riveted_joint`. Textbook-pinned Khurmi Ex 9.2 double-riveted lap (t15/d25/p75) → tearing 300 kN governs, η=66.7%. Smoke IS the proof — 67 assertions: η∈(0,1) + strength=min, governing-mode FLIPS (each mode weakest in turn), balanced beats unbalanced at equal solid-plate, double-cover doubles Ps, Pt is n-independent so the plate eventually tears |
| Pipe fittings: elbow | `src/lib/engineeringPipeCore.ts` (pure: `elbowGeometry` partial-revolve Pappus wall volume θ·Rb·π(ro²−ri²) + bore/fluid volume θ·Rb·π·ri²; `buildElbowBlenderScript` sweeps the pipe annulus along the bent centreline in bmesh — outer wall + inward bore wall + annular end caps → watertight, NO boolean). A new toroidal/swept class; θ=360° is the torus-shell limit. `engineering.model_3d` part 'elbow' (angle/bendRadius/od/id or wall). LIVE `npm run drill:engineering-pipe`: 90°/45°/180° elbows in Blender — wall volume = partial Pappus to 0.18%, watertight, bore proven open. A 4th independent volume method (partial revolve) beside extrude/full-Pappus/CSG |
| Disc cams (motion) | `src/lib/engineeringCamCore.ts` (pure: `motionFraction` uniform/harmonic/cycloidal displacement laws; `camProfilePoints` folds a dwell/rise/fall program into a polar profile r(θ)=rb+s(θ); `camGeometry` base/peak radius, shoelace area, volume; `buildCamBlenderScript` EXTRUDES the profile with a shaft bore via the profile-solid extruder). Opens the MOTION arm. `engineering.model_3d` part 'cam'. Program must close (return to start displacement, sum to 360°). Motion laws textbook-pinned (harmonic/cycloidal cross h/2 at midpoint, smooth ends vs uniform's impact). LIVE `npm run drill:engineering-cam`: harmonic + cycloidal cams in Blender — volume = (profileArea−bore)·thickness to 0.00%, watertight, disc height exact, shaft bore proven open |
| A11y action verification diff | `src/lib/a11yTreeDiff.ts` |
| Illustrator ExtendScript adapters | `src/lib/illustratorExtendScriptAdapters.ts` (LOCKSTEP: `scripts/claude-bridge.js`) |
| Per-app automation profiles | `docs/apps/*.md` + `src/lib/appAutomationDocsIndex.ts` (status lockstep smoke) |
| App reachability (live ladder) | `src/lib/appReachability.ts`, `src/lib/appReachabilityProbe.ts`, tool `desktop.app_reachability`, `/apps` command |
| App screen observe/next-step | `src/lib/appScreenNextStep.ts`, tool `desktop.observe_app` (one-round-trip observe + Δ diff + suggestion) |
| Unknown-app menu discovery | tool `desktop.menu_inventory` (read-only System Events menu-bar catalog: names/enabled/submenus; never clicks/focuses/launches; feeds exact labels to `desktop.menu_click`); apps that draw menus in their own window (Blender-style) come back with only Apple/Window menus, which routes the agent to `observe_app`/a11y instead |
| Marketplace prompt context | `src/lib/marketplaceIntegrationContext.ts` |
| Codebase index/search + @mentions + conventions (coding-agent P4) | `src/lib/codebaseIndexRuntime.ts`, `src/lib/projectConventions.ts`, pure cores `codebaseIndexCore/codebaseSymbolCore/codebaseMentionsCore` |
| Live TODO + tool-result summarization + run-and-fix gate (coding-agent P6) | `src/lib/agentTodoCore.ts` + `agentTodoStore.ts`, `src/lib/toolResultSummaryCore.ts` (in `agentExecutionCore.ts`), `src/lib/runAndFixGateCore.ts` (in `openswanSessionRuntime.ts`) |
| Google Workspace tools (Gmail/Docs/Sheets/Drive/Calendar) | `src/lib/googleWorkspaceOps.ts` (pure contracts), `src/lib/googleWorkspaceRuntime.ts` (token+fetch), `gmail.*`/`gdocs.*`/`gsheets.*`/`gdrive.*`/`gcal.*` in `openswanToolRuntime.ts`; OAuth Phase A: `supabase/functions/google-oauth/index.ts` + `src/lib/googleCreds.ts` + `[functions.google-oauth]` in `supabase/config.toml` so OPTIONS/callback reach the function's own auth boundary |
| Cross-dashboard awareness (what's connected: marketplace/vault/Google/keys) | `src/lib/connectedResourcesDigest.ts` (pure, secret-safe) + `src/lib/connectedResourcesRuntime.ts` → `connected_resources` prompt section in `swanbot.ts` |
| Vault credential → browser login | `browser.fill_credential_field` (`credentialId` = circle vault via `vaultAgentAccess`, or `item` = 1Password) in `openswanToolRuntime.ts`; remote `fill_saved_login` in `supabase/functions/computer-use-agent/index.ts`; login-wall recovery pointer in `src/lib/computerTaskEvidenceRecovery.ts` |
| Local diagnostics + connected coding execution | `local.run_shell` + `git.run` remain compatibility names in `openswanToolRuntime.ts`, but now expose only fixed read-only git diagnostics and `node --check/--version` through `POST /desktop/exec_file` with an exact read grant. Shells, package scripts, tests/builds, and mutations are refused and must delegate through a paired Codex/Claude/Cursor/Gemini structured spawn/launch handoff with its normal approval/file-coordination boundary. |
| Context dial + receipt (`/context` lean/standard/max) | `src/lib/contextDepthPolicy.ts` (pure: depth transform — 'standard' is identity — floor compose, receipt, storage); wired at the complexity-floor + policy chokepoints in `swanbot.ts buildSystemPromptAsync`; command handled in `ChatTab.tsx`, registered in `chatCommandRegistry.ts` |

Rule: new routing behavior goes into the relevant owner above. Do not extend
legacy one-off routers when the planner/runtime owner already exists.

## Provider Routing

Provider routing is now a first-class app system, not a side list.

Current provider set includes Anthropic, OpenAI, OpenRouter, Hugging Face,
Groq, Google AI, Mistral AI, Cohere, Perplexity, Together AI, Fireworks AI,
DeepSeek, z.ai, MiniMax, Ollama, GitHub Models, Replicate, Brave Search, and
browser/computer providers such as Browserbase and Stagehand.

When adding or changing a provider, keep these files aligned:

- `src/lib/llmProviders.ts`
- `src/lib/llmProxyErrorCore.ts`
- `src/lib/circleIntegrations.ts`
- `src/lib/serviceProfileSouls.ts`
- `src/lib/crossProviderRouter.ts`
- `src/lib/billingPriority.ts`
- `src/lib/swanbot.ts`
- `supabase/functions/llm-proxy/index.ts`
- `supabase/functions/swanbot-ai/index.ts`
- provider CHECK constraints in migrations

Provider failures keep stable public codes across the Edge/browser boundary.
`key_missing` means no applicable credential; `credential_unreadable` means a
stored ciphertext or key-version problem and directs the owner to reconnect or
re-enter the credential, never to a connected code-repair agent.

The 2026-08-07 plain-Chat credential contract is user-owned BYOK end to end.
Future or unconfigured threads default to `claude-sonnet-4-6`; an explicitly
stored `auto` remains `auto`, and the forward migration does not rewrite
existing thread rows. Authenticated `chat-stream` and public `llm-proxy`
dispatches require the signed-in user's Marketplace credential and cannot fall
through to a platform environment key. `key_missing` and
`credential_unreadable` are terminal setup states for that turn: Chat does not
repeat the same call through another transport, and instead opens the matching
Marketplace model connection. Anthropic connect/reconnect validates the
submitted key before saving, stores it only in the user's encrypted model-key
vault, then validates the stored/decrypted credential through the same
`llm-proxy` route Chat uses before reporting success.

Semantic-memory embeddings follow the same user-owned rule for OpenAI. A
`key_missing` or `credential_unreadable` embedding response pauses that
signed-in account after one serialized, timeout-bounded probe while the null
rows remain on the durable repair path. A successful OpenAI Marketplace write
invalidates stale in-flight failures and forces one bounded repair; unrelated
provider writes do not retry embeddings.

Model IDs may be provider-prefixed, such as `openrouter/auto`,
`google_ai/gemini-2.5-pro`, `deepseek/deepseek-reasoner`, or
`huggingface_endpoint/cswan801/BlackSwan-v5`. Normalize aliases carefully:
`hugging_face` -> `huggingface`, `z_ai` -> `zai`.

Chat Web Search is optional enrichment, not the terminal owner of ordinary
conversation. Pure greetings stay on plain Chat even when the saved toggle is
on. If search fails, Chat shows a bounded not-web-verified notice and continues
through the canonical plain transport exactly once; it does not create a FAILED
action receipt or offer a connected code-repair agent for that optional lane.

## BlackSwan And OpenSwan

- BlackSwan-v5 lives at `cswan801/BlackSwan-v5`.
- Public HF path: `huggingface/cswan801/BlackSwan-v5`.
- Dedicated endpoint path: `huggingface_endpoint/cswan801/BlackSwan-v5`.
- Tool-heavy BlackSwan requests use a reliable tool executor model —
  `BLACKSWAN_TOOL_EXECUTOR_MODEL_ID` in `src/lib/blackswanRouting.ts`
  (currently `claude-haiku-4-5`) — while BlackSwan remains app-grounding
  context.
- Training/auto-update: weekly launchd job on the dev Mac (Sunday 03:00,
  `scripts/blackswan-llm/launchd/`), full cycle in
  `scripts/blackswan-llm/train_cycle_v5.sh` — see
  `scripts/blackswan-llm/CONTINUOUS_TRAINING.md`.
- `buildBlackSwanGroundingBlock` injects app-state rules and safe memory
  references without exposing secrets.

OpenSwan remains the in-app shared agent/runtime brand. The internal default
agent id `default::blackswan` should not be renamed without a migration plan.

Chat presents one consistent OpenSwan navigation map in circle, private, and
shared threads. `ChatThreadHeader` remains mounted before Chat chooses an
empty or populated transcript state, clears stale metadata while a new thread
loads, and keeps the `OPEN`/`OPENSWAN` and `RUNS` entries available through
loading, empty, active, and thread-resolution error states.
`OpenSwanServiceMenu` owns mode and crew selection, sends
agent/model/approval/tool configuration to the existing Control Panel, and
sends past or blocked work to the existing Run History surface. These are
navigation-only components: preserve the callbacks and canonical runtime
owners, plus responsive layout, keyboard focus, and semantic labels. Run
`npm run check:openswan-chat-ux` when changing this surface. The composer
selector uses `chatAgentSelectorPresentation` so target availability and
runtime activation remain truthful: normal Chat reads
`Chat · OpenSwan available`; only a selected runtime mode reads
`<Mode> · OpenSwan active`. Advanced choices expose expanded/selected
accessibility state. `Reset Mind` requires explicit destructive confirmation,
clears circle session and current-user memory context, and preserves the
visible transcript.

Changing threads is an authoritative lifecycle. Chat clears the old transcript
immediately, validates exact circle/archive access, restores only the target
thread's draft and staged attachments, and blocks sending until hydration is
ready; resolution failure exposes Retry. It refuses silent switching while a
run or upload can still write back to the old thread. On narrow screens the
conversation list opens as an accessible overlay, and destructive archive,
delete, leave, and member-removal actions are confirmed. Message and thread
subscriptions reconnect with a scoped catch-up and run a quiet repair
heartbeat; the message transcript additionally polls every 15 seconds only
while its channel is degraded. An authoritative tail removes
missed deletes while preserving older pages, optimistic sends, and rows created
after the read began. Older pagination uses `(created_at, id)`, and reply
previews are batch-hydrated.

Bot-message durability is explicit. `transcript` is the default and may enter
Postgres, model history, memory extraction, pending recovery, and the session
archive. `ephemeral` greetings, progress/routing copy, and command/navigation
help stay visible locally but enter none of those durable/model inputs. Known
legacy ephemeral source surfaces are also dropped during hydration. Outcomes,
blockers, and recovery evidence remain transcript messages.

## Computer Use

For the end-to-end app/browser/desktop task pipeline (route -> contract -> loop
-> resume -> verify), the nine tool-loop reliability layers, cross-surface
parity, and the rules for extending it, see
`docs/UC_APP_TASK_RELIABILITY_ARCHITECTURE.md`.

Browser computer use is split into:

- planning and preview in `src/lib/computerUse.ts`
- run state in `src/lib/useComputerUseTask.ts` and
  `src/lib/useComputerUseQueue.ts`
- edge execution in `supabase/functions/computer-use-agent/index.ts`

`computerUse.ts` does not have the genuine authenticated user/circle/persisted
run, provider `toolUseId`/iteration, durable claim, and exact OpenSwan approval
identity required for mutation. Its planned `navigate`, `click`, `fill`,
`select`, `press_key`, and `scroll` actions therefore become visible,
value-stripped, structured non-executable typed OpenSwan handoffs before
screenshot, Stagehand, MCP, or bridge mutation I/O. Continue through a fresh
typed Chat/OpenSwan call; never retry a mutation through the legacy/raw lane.
Saved-plan replay preflights the whole plan and permits only the reviewed
observation allowlist.

Native Anthropic computer use currently requires a Sonnet-capable model in the
edge loop. If a user selects an unsupported model, the edge function falls back
to the default Sonnet computer-use model. Text-only planner/validator work may
use marketplace models, but the native screenshot/action loop must stay on a
computer-use-capable model.

Local computer awareness goes through `src/lib/localComputerAwarenessIntent.ts`
and bridge tools. Reads such as tabs, running apps, clipboard inspection,
screen state, file list/read/search, and accessibility tree are lower risk.
Exact launch/focus is the narrow reversible lifecycle exception. A
model-issued lifecycle call needs an authenticated persisted run plus exact
provider tool-use identity; a strict compiler-owned Chat command may instead
use its bounded direct-request authority through the paired local bridge.
Both paths require fresh exact-app before/after proof. Open URL/path,
clipboard write/clear, shortcut run, window management, and all downstream
mutations keep the risk/approval path described in the runtime docs.

Before executing a chat request that asks to operate another app, browser,
local file, CAD tool, Adobe design file, or unfamiliar desktop program,
`src/lib/chatComputerRequestRouter.ts` builds the hidden best path: computer
preview, selected pipeline, app/browser strategy, surface order, approvals,
fallback pipelines, recommended tools, and proof requirements. Keep this route
quiet in chat; show the user only approval, proof, or actionable blockers.
The route also carries the typed app automation decision from
`src/lib/appAutomationControlSurfaces.ts`, so app/browser tasks can stop for
fresh observation, approval, user action, or connected-agent buildout before
mutating another surface.
Use `src/lib/chatComputerRequestUx.ts` for that visible/hidden notice decision
so app/browser/desktop routes share the same user-friendly wording and actions.
Live computer handoff metadata and persisted chat rows should carry that notice
and the compact route-decision summary through
`src/lib/chatComputerHandoffContext.ts` instead of inventing new copy.
`src/lib/computerTaskEvidenceContract.ts` owns observe-before, actionability,
approval, proof-after, fail-closed, retry-evidence, and source-reference
requirements for those routes. `src/lib/computerTaskEvidenceRecovery.ts` owns
failure-time contract diagnosis so chat recovery can choose fresh-evidence
retry, user unblock, connected-agent adapter repair, or stop/report. It also
emits required evidence tools plus readiness state so retries can fail closed
when observations are missing or stale. Pass the compact app route decision into
that recovery path so route-level missing confirmations, approvals,
user-action blockers, and connected-agent buildout decisions shape the recovery
options instead of being lost after preflight. A pure desktop launch/focus/read
contract requires only exact app/window identity and the smallest requested
app-native or accessibility observation. It must not inherit file search/stat,
document mutation, browser fallback, export proof, or approval requirements;
those are added only when the typed task actually needs them.

Strongly framed `Use`/`Open`/`In <App>` requests, including long-tail app
names, stay desktop-owned and exclude browser tools/fallbacks. Literal URLs,
web-only apps, WordPress, transactional web intent, and browser-product
navigation remain browser-owned; a strict lifecycle-only `Open Chrome`-style
command targets the installed native app without adding `browser.open_url`.
An otherwise ambiguous lowercase long-tail lifecycle target such as `houdini`
or `acme studio` enters that direct branch only when the refreshed bridge-online
app-resolution context contains the exact normalized installed/running name;
an unavailable name or stale offline inventory remains conversational.
Finder/Preview/TextEdit file-shaped work stays local-file. The
closed-world Photoshop compiler remains isolated from this generic route.
Names such as Docker Desktop and Microsoft Remote Desktop are exact app
identities, not evidence that the task concerns a file on the Desktop folder.
Read-only named-app routes may expose launch/focus/wait/observation tools only;
the router must rebuild the route before any mutation tool can be dispatched.

`parseStrictNamedAppLifecycleIntent` in `src/lib/genericAppNavigator.ts` is
the shared source of truth for strict single-intent `open` / `open up` /
`launch` / `start` / `focus` / `activate` / `switch (over) to` / `bring ...
to the front` / `bring ... forward` commands, including bounded polite
wrappers and trailing `please`. Router and preflight consume the same result,
so these commands require only `desktop_control` and cannot drift into an
`app_tools` buildout. The router retains the user's app phrase separately from
the canonical local bundle/process dispatch identity. It compiles an immutable
no-AI lifecycle program; `ChatTab` passes that program and its STOP signal to
`computerTaskRuntime`, which reuses `executeObservedNativeAppActivation` for
observe-first launch-if-needed, focus, and fresh foreground proof. Cancellation
is a neutral typed `cancelled` terminal, not a blocker/recovery loop. Guidance
questions, generic nouns/files, and requests with any follow-up clause do not
compile. The observed-name exception never outranks those guards. Semantic
state reads remain model-assisted, and app/document
mutations keep their normal approval and evidence boundaries.

`buildGenericAppSemanticWorkflow` in `src/lib/genericAppNavigator.ts` is the
canonical unfamiliar-app decomposition contract. It preserves the exact user
request and emits at most ten ordered checkpoints with observe-before evidence,
allowed semantic surfaces, mutation/approval class, expected postcondition,
and a buildout/stop rule; verification of every original clause is always the
last checkpoint. The allowed surfaces are adapters, app lifecycle,
app-native APIs/scripts, documented file adapters, embedded DOM/CDP,
accessibility, semantic menus, and verified shortcuts. Coordinates are not in
the workflow schema.

Pure observation and exact launch/focus/wait do not create approval prompts.
Model-issued launch/focus still requires authenticated persisted-call identity;
the strict compiler-owned Chat lifecycle path uses bounded direct-request
authority through the paired bridge. Both require fresh exact proof.
Reversible non-secret field/menu/toggle checkpoints share
one bounded workflow review rather than prompting once per control, but each
runtime mutation must still consume its canonical exact-call receipt.
Persistent/external/destructive/credential/permission and ambiguous steps keep
their exact approval or user-choice floor. Missing semantic target, target
drift, or uncertain post-dispatch state stops the workflow; it does not unlock
coordinates or automatic replay.

The first enforced-action foundation lives in
`src/lib/computerAppGrounding.ts`: short-lived observation epochs bind a
proposed mutation to the exact app/process/window/document or browser
session/tab. A deterministic secret-safe fingerprint of canonical normalized
handler args is bound into the sealed contract and runtime-issued exact-call
policy. Conservative unknown-mutator risk, fail-closed process-local
idempotency, single-use authorization expiry, and a sealed handler-entry
receipt guard the foundation. A task can complete only from a newer
runtime-issued same-target after-state.

Typed OpenSwan `browser.fill_field` is one of three integrated browser mutation
routes. The shared loop validates each provider `toolUseId` as a bounded run-wide-unique
capability, rejects a malformed/reused round before any handler enters, and
passes the exact `toolName`, `toolUseId`, and iteration into a fresh call
context. The runtime normalizes one exact non-secret draft, takes a DOM
observation, then calls `POST /browser/fill_target` to resolve and inspect
exactly one field before approval. That read-only step returns a short-lived,
single-use `targetId` backed by the exact ElementHandle and an HMAC privacy-safe
v2 `targetFingerprint` over all inspected semantics plus keyed
document/node/frame structure. The target id is dispatch-only and excluded from
durable approval, receipts, and model output. Durable approval stores SHA-256
bindings for the exact normalized intent and page URL plus bounded safe
origin/length and opaque process/context/page/fingerprint metadata. It does not
persist raw draft text, URL path/query/fragment, locator, or task context, and
accepts only a genuine receipt backed by an `agent_run_approvals` row. Category auto-approval creates
an exact durable `auto_approved` row first; run-scoped and consumed cross-run
approvals preserve their real row id/source. Missing ids and lookup failures
block.

The source-default SwanBot v2 edge `browser.fill_field` schema matches this
sealed non-secret/non-submit contract: it requires bounded `text` plus exactly
one accessible `name` or CSS `selector`, permits only an optional
textbox/searchbox role and bounded exactness/timeout/task context, and rejects
extra fields. There is no submit field or combobox role. Dropdown selection and
saved credentials stay in their dedicated tools. Exactly one locator is not
merely a model-schema hint: the edge schema, app normalizer/sealed runtime,
browser client request builders, and bridge target/perform endpoints each
enforce `name` XOR `selector`; both-present and neither-present inputs stop
before observation or dispatch.

The local browser bridge issues opaque process/context/live-document identity;
the page id changes on main-frame navigation or reload, including a same-URL
reload. Guarded handler entry consumes the target id once, rechecks live
identity and the target fingerprint, and inspects direct attributes, associated
labels, `aria-labelledby`/`aria-describedby`, and the containing form for
credential/recovery/seed/private-key/payment/CVV signals. It reads the same
handle before mutation and skips `fill()` when the approved draft is already
present, avoiding duplicate input/change handlers after an outcome-unknown
attempt. Both the app normalizer and the bridge reject obvious secret-bearing
draft values without reflecting them. The mutation action SHA-256-binds the
exact transient handler args; the dispatcher recomputes the digest from a
deep-frozen clone, revokes the observation epoch at handler entry, and passes
only sealed args to the handler. Proof then uses one exact-handle renderer
capture of value, semantics, document, node, and frame state bracketed by
stable browser identity checks. It contains only fingerprint, server-side
value equality, bounded lengths, a mutation/no-op flag, timestamp, and evidence
identity; it never echoes the requested/observed value or ephemeral target id. Navigation, close, bridge
restart, capability expiry/replay, detachment, or target drift fails closed and
requires a fresh observation. Completion requires that redacted proof to
produce an accepted same-target verification receipt.

`browser.set_toggle` is the second sealed route. It sets one exact checkbox,
switch, or radio to an explicit boolean through the same provider-issued call
identity, genuine exact-call approval, single-use ElementHandle capability,
keyed target fingerprint, verify-before-replay, and redacted after-state proof.
Both model and bridge boundaries require positive local presentation or
accessibility semantics; consequential and unknown settings fail closed. The
approval card includes a bounded secret-redacted target summary but not the raw
selector, task context, exact URL, or one-shot id. Generic `browser.click_role`
inspects its resolved handle and refuses native/ARIA state controls, labels,
and descendants so it cannot bypass this route.

`browser.select_option` is the third sealed browser route. It accepts one native
single-value select and one exact option value or label, takes a dedicated
fresh target/option observation, selects at most once, and proves the exact
option on the same live handle without submitting or navigating. Multi-select,
ambiguous options, protected/unknown settings, stale handles, and target drift
fail closed. Generic click refuses select/combobox/listbox/option targets,
labels, and descendants, so it cannot bypass the dedicated select lane.

`src/lib/agentActionCalls.ts` plus §26 owns durable cross-process claim/start/
finish for fill, toggle, select, the narrow native semantic press,
`desktop.open_path`, manual automation file writes, and approval-gated
external edge mutations. An
authenticated claim binds user, circle, persisted run, exact tool, provider
`toolUseId`, action id, tool-argument fingerprint, authorization-contract
fingerprint, and idempotency key without storing raw args, selectors, URLs,
content, or unrestricted metadata. The state machine is `claimed → dispatched
→ verified / outcome_unknown`; `failed` is valid only while a row is still
undispatched `claimed`. Handler entry atomically records `dispatched`, and
duplicate or terminal calls never re-enter the bridge handler.

Concurrent claimers may receive the same token. A worker that loses before its
callback therefore leaves the claim unfinalized/reclaimable instead of
overwriting another worker's dispatched action. Any error after confirmed
handler start maps only to `outcome_unknown`; the TypeScript parser rejects a
forged failed-after-dispatch payload. If fresh proof verifies the task but the
final database acknowledgement is unavailable, the user-facing result remains
truthful `ok: true` while warning that the exact call is replay-blocked.

Native `desktop.click_element` is a narrow semantic-press canary. It requires a
fresh indexed accessibility observation, exact app/PID/path/role/label/
fingerprint agreement, genuine exact approval, one target-bound press, and a
refreshed exact-target semantic diff. It does not authorize arbitrary desktop
coordinates, consequential controls, or general native-app mutations.

SwanBot v2 routes every browser/desktop mutation currently registered as
client-delegated through the canonical OpenSwan runtime before any raw
dispatcher, preserving provider tool name/id/iteration. The five guarded
canaries additionally keep their sealed proof, durable action-call, and
sanitized receipt contract; hidden receipt subsets never enter model content,
are re-sanitized at the edge, and persist as correlated client result events.
This current-catalog interception is not a universal guarantee for future tools,
other callers, or mutation families without a sealed verifier.

The default edge continuation client unions hard constraints parsed from the
raw turn with richer upstream constraints. Before handler entry it executes the
constraint/always-confirm floor and then, when supplied, the live exact-call
review callback. Missing required approval, rejection, or callback failure
blocks without dispatch. A live review surface serializes the batch so approval
prompts cannot race or reorder decisions. A non-empty always-confirm floor
forces every non-read browser/desktop call through that gate, including bland
or opaque keypresses and unknown/future mutation names whose arguments do not
repeat the floor.

Continuation resume is encrypted, bounded, and single-consumer. The exact
paused model/tool snapshot is minimized and sealed with AES-256-GCM by
`swanbot-continuation-crypto.ts`; it is never stored as plaintext. Public
`agent_runs.metadata.continuation` contains only a value-free CAS envelope:
opaque identity, protocol/storage versions, one-time nonce, resume/claim state,
bounded counters/tool identities/timestamps, an `expiresAt` exactly ten minutes
after `pausedAt`, and the authenticated ciphertext envelope. Public tool-event
inputs are structural value-free schemas and persisted failures use stable
redacted codes/copy. Exact arguments and errors remain transient for live
approval, dispatch, proof, and model-loop work.

Deployments must explicitly configure a dedicated
`SWANBOT_CONTINUATION_ENCRYPTION_SECRET` and
`SWANBOT_CONTINUATION_ENCRYPTION_KEY_VERSION`; do not derive or reuse the
service-role key or another shared credential. The source fallback key version
`v1` is not a key-rotation configuration. With no continuation encryption key,
SwanBot withholds every `clientOnly` tool before the model turn and dispatches
no local action instead of creating a plaintext or unresumable checkpoint.
AES-GCM additional authenticated data also binds the canonical lowercase
`runId`, `userId`, and `circleId` for the persisted row. Those identifiers are
not copied into the six-field public ciphertext envelope, and moving ciphertext
to another row fails through the same unreadable-close/no-replay path.

The client must first present a client-generated exact claim: an edge CAS
changes `pending` / `client_pending` to `dispatch_claimed` /
`client_dispatching` before any local tool handler runs. Only the exact echoed
claim may dispatch. Exact result submission then atomically rotates that state
to `results_claimed` / `client_resuming` before the model loop resumes, and that
claim gates every later next-pending or terminal update. Competing or non-exact
duplicate claims, ambiguous acknowledgements, expired leases, failed
claim-bound writes, and post-claim loop failures become `outcome_unknown` with
no reopen or automatic replay. Only an exact same-claim dispatch retry carrying
the already-winning claim is idempotently acknowledged; a different claim or
mixed protocol/state never is. Readiness ignores all three active stop-reason
rows: `client_pending`, `client_dispatching`, and `client_resuming`. Every edge
pending, checkpoint-failure, continuation-close/seal, cancellation, failure,
and terminal writer repairs a complete run summary: an array `tool_calls`, an
`iteration_count` of at least one, and finite nonnegative input/output/cache
token fields. Write diagnostics expose only a bounded operation name and safe
machine code for these summary/checkpoint/close/CAS paths; older claim/event
logging elsewhere in the Edge remains outside that guarantee.

Terminal integrity is independent of the model's final prose. Once a
client-delegated mutation is durably recorded as dispatched but returns
`ok: false`, lacks accepted verification, or reports outcome-unknown, that
condition latches across continuation rounds. A later model `end_turn` cannot
convert it to completion: the edge persists a replay-blocked failed terminal,
publishes no completed Feed card, and returns a structured non-fallback 409.
Fresh terminal writes also check the compare-and-set result and exact reread;
a late user cancellation wins, while any other ambiguous write stops before
publication. The client preserves `cancelled: true` as a neutral reached-edge
terminal for empty or nonempty model tails, so STOP never trips the transport
breaker or falls through to v1. Any other authenticated/reached-edge empty
terminal is likewise non-fallback and surfaces a stable missing-payload stop.
Direct WordPress and workspace mutations now stamp a value-free receipt at the
exact provider/database/UI dispatch boundary; only concrete returned identity
and state can add accepted completion proof, while `workspace.open_preview`
and ambiguous trash responses remain outcome-unknown. The original
`turnRequestId` is preserved in every fresh pending, terminal, cancellation,
and failure metadata replacement, so a lost-response retry collides before
another model or Feed run.

The edge also latches before every server-side memory/task/mission/message/
room/approval writer enters its handler. If a later model or runtime failure
makes that turn ambiguous, the run closes as
`server_mutation_outcome_unknown` with `replayAllowed: false` and a
verify-before-new-action marker. The client reads that structured non-2xx
response and stops before v1 fallback, rather than retrying the whole turn
under a new run identity. A modern fresh call generates one UUID
`turnRequestId`, reuses it across transport attempts, and the edge inserts it
as `agent_runs.id`; a duplicate primary-key attempt stops before the model.
Legacy/no-identity fresh calls retain read-only/text work but have every
server-side writer withheld.

Section 29 adds a service-role-only, atomic continuation privacy sweep. When
installed, its named `pg_cron` job runs every three minutes (or emits a stable
NOTICE when cron is unavailable) and closes active missing, legacy/plaintext,
malformed, state-mismatched, or expired checkpoints with a value-free
`continuationResumeOutcome` and `replayAllowed: false`. `client_pending` closes
as `failed_before_dispatch`; claimed `client_dispatching`/`client_resuming`
work closes as `outcome_unknown`. The migration separately performs a one-time
scrub of terminal/non-active checkpoints. Its protected-row trigger also
rejects authenticated INSERT/UPDATE/DELETE attempts for active SwanBot v2
continuations, preventing row cloning or protected-field rewrites while
preserving existing reads, service-role/Postgres maintenance writes, and the
exact owner-only `running → cancelled` STOP transition followed by one bounded
write-once cancellation-provenance merge. Every row terminalized by the sweep
also repairs its existing tool/iteration/token summary columns to safe shapes;
those values are not copied into outcome metadata.

The legacy `computerUse.ts` planner/executor is observation-only. All six legacy
Computer Use mutation kinds—`navigate`, `click`, `fill`, `select`, `press_key`,
and `scroll`—return structured non-executable OpenSwan handoffs before
screenshot, Stagehand, MCP, or bridge I/O; saved-plan hydration and persisted
session projections strip mutation values. `/replay` likewise preflights the
complete recording and runs zero steps when any browser/desktop mutation is
present. Only its explicit observation allowlist can replay locally.

The hosted Browserbase Computer Use lane is separately source-hardened as of
2026-07-26. `computerUseAgent` sends a bounded schema-v1 execution-policy
envelope that the edge validates before provider/session work. Authenticated
Chat/queue calls require an interactive envelope; watch/service calls are
forced to scheduled observation-only execution. Authenticated legacy callers
without a policy receive HTTP 400. All three root Chat cloud starts—automatic
browser launch, booking-session continuation, and manual approved launch—use
`buildChatComputerUsePolicyInputs` to preserve derived user constraints plus
the opaque-target, credential, and external-side-effect confirmation floors.
The single-task and queue hooks acquire synchronous start reservations before
imports or credential lookup, count pending starts against capacity, and
invalidate those reservations on cancel/clear.

Computer-task UI and runtime ownership is also exact-thread scoped. Switching
thread, circle, user, or unmounting cancels the owned cloud/local handle,
invalidates late callbacks, clears local session and pending-permission state,
and prevents a result from being persisted into the next thread. A durable
`executing` record without a live reattach owner hydrates as blocked/unverified,
never as resumable work. Capability-buildout polling reads checkpoint state
through a stable ref so each save cannot restart its own polling effect.
Permission submission reserves synchronously against double clicks, and the
Computer Use/particle animations have one cleanup-owned loop with stable hook
topology.

The edge classifies left/right/double click, type, key, and saved-login filling
as mutations; unknown native actions fail closed. Because current coordinate
and focused targets are opaque, every such mutation requires durable exact-call
live confirmation even when a pre-run grant exists. An approved call is
bracketed by fresh pre/post screenshots and uses one-attempt dispatch.
Missing pre-action proof blocks before dispatch; a dispatched but unverified
result becomes `mutation_outcome_unknown` with no automatic replay.
Secret-bearing type/key/credential/question data is redacted or omitted across
SSE actions, progress/action traces, model history, guided replay, stuck-solver
payloads, usage metadata, and errors.

`computerTaskRuntime` no longer performs a generic deterministic app mutation
or attachment open/wait before the authenticated typed agent loop. Read-only
live observation may still precede `executeAgentRun`; model-planned app/hybrid
work itself does not. A compiler-owned exact program is the narrow exception:
when every call, argument, and authorization mode is present in the immutable
Chat plan, its local executor can run without an LLM relay. The router-owned
strict named-app lifecycle program is one reversible instance; it carries only
observe, conditional launch/wait, focus, and final observe calls and remains
separate from document/UI mutations. `src/lib/computerSequenceProgramCore.ts`
owns the independent exact Photoshop blank-document family: app-native
status, conditional launch, status, exact create, and final status proof. It
uses the current direct command for one closed-world new unsaved document at or
below 4096 px per axis / 16 MP; larger allocations retain one SHA-bound Chat
approval. Appended or unknown edit/save/export/overwrite/delete/login/purchase/
external instructions cannot inherit direct authority. It does not request a
source file, layer inventory, generic UI fallback, or capability buildout, and
an unverified post-dispatch result cannot replay. The shared polite-command
envelope also recognizes natural `Can/Could/Would you ...` and `I need you to
...` variants for this exact family without widening its action whitelist. The
visible exact-task card mirrors that program as Status -> Prepare -> Create ->
Verify and omits generic file resolution, edit, layer review, export, and
handoff copy. When required, a filed/pending plan approval remains an awaiting-approval state
instead of launching generic failure recovery. Chat holds only an ephemeral
approval-id -> exact task/thread resume entry, deletes it before continuation,
and automatically reruns the exact executor after approval; the durable gate
still recomputes and atomically consumes the fingerprint before desktop work.
That convenience is same-mounted-ChatTab only: approval after refresh or from
Office/another client safely requires an exact retry rather than persisting raw
task text as continuation state.
This removes the broad pre-agent app-adapter and attachment-open bypasses.
The strict lifecycle dispatcher and courtesy grammar were source-, smoke-, and
typecheck-verified on 2026-08-05; no new live lifecycle GUI/bridge run or
deployment validation is claimed for that slice.
A separate Chrome-free terminal drill is available as
`npm run drill:photoshop-exact`. It is non-mutating by default and requires an
explicit `--live` flag plus the current dry-run confirmation fingerprint before
using the fixed loopback desktop bridge. The drill derives the immutable
manifest from the production exact compiler and requires strict Photoshop
identity and foreground proof. Its own smoke checks the drill, while the paired
`smoke:computer-task-runtime-context` independently pins the production
executor's bounded retry, STOP, identity, and exact-proof source contract; this
is not a shared-helper or end-to-end production-parity test. The drill dispatches
the create operation at most once. After a positive named create
receipt, both the production executor and drill may make at most three fresh,
read-only app-native status checks at 250 ms intervals; the create action is
never re-entered by that invocation's proof loop. Success requires the exact
created document name and 600x600 dimensions. Durable deduplication across a
separate concurrent or restarted invocation is not claimed. Its focused
contract gate is `smoke:photoshop-exact-drill`.
On 2026-08-05 one live drill invocation made exactly one create call and zero
browser calls. Its immediate proof read was stale, so that original invocation
correctly exited `verification_incomplete`; a separate fresh read-only status
then proved Photoshop frontmost with active document `Untitled-1` at 600x600.
The bounded status-only retry was added from that finding and has not been
validated by a second live create. This scope does not exercise the
authenticated Chat UI, approval filing/consumption or persistence,
message/Realtime continuity, or browser focus/event wiring.
Live validation on 2026-07-31 submitted the motivating request through the
refreshed authenticated Chat UI from a fresh Photoshop `appRunning:false`
status. It created no approval row, persisted the completion, and final
app-native status proved `Untitled-1` at 600x600 px, RGB, 72 ppi, with one
layer. After refresh, an exact computer-task approval has no durable in-memory
continuation, so Chat offers `Ask again` only while that row remains inside its
normal live/expired visibility window; stale rows age out. A newer completion
in the same thread never suppresses an approval by chronology alone because a
thread can contain unrelated tasks.
Chat never reconciles task cards by prompt wording, normalized request text,
structural similarity, or a shared chat-turn id. An older ready/approval card
becomes `Superseded` only when a later structured, verified completion shares
its exact immutable run id or explicit request id. Without that exact lineage,
the card becomes `Historical` only after a newer human turn from the same
stable author; a different circle member's later turn cannot deactivate it.
New bot rows persist that requester as `requestAuthorId`, so interleaved shared
threads do not infer ownership from message proximity. Legacy proximity
inference is allowed only when the transcript has at most one known human
author; ambiguous multi-author legacy cards fail open as `Current`.
For metadata-free legacy rows, the only fallback is a strict actionable
desktop-plan signature: approval/readiness language plus a concrete control
phrase such as `Approve desktop run`, `desktop-app path`, `app-native tool`, or
`desktop.*`, with failure and blocked statuses excluded. Even that fallback can
only become `Historical` after a newer same-author turn; text can never prove
completion or supersession. Both inactive states are read-only: phase, proof,
review, and browser-session evidence remain visible while approval, launch,
verification retry, recovery, run-stop, and run-again mutations disappear.

Legacy deployments that still enforce `messages.content <= 1000` use a safe,
parseable persistence retry instead of slicing through structured metadata.
`persistedChatMetadata` preserves only a bounded, redacted source/status/
lineage envelope, fits visible text around complete JSON, validates the
candidate before submission, and otherwise emits an explicit marker-free
text-only row. `chatService` acknowledges the returned database row only when
its present local-message, run, request, requester, status, and source fields strictly
round-trip (or the marker-free text matches exactly). Truncated, unparsable, or
parseable-but-mutated metadata keeps the recoverable local pending record.
Typed-batch and outer failure terminals now use one durable pending-row
finalizer, verification retries update the saved bot row, and message Realtime
merges INSERT and UPDATE envelopes through reconnect/catch-up into mounted
clients; an authoritative bounded snapshot repairs missed DELETE events. If a
bot UPDATE has no valid envelope, Chat clears stale structured controls instead
of retaining unproven actions. If a computer mutation may have dispatched but
final proof is missing, the persisted handoff carries
`replayPolicy: manual_verify_only`, `mutationDispatched: true`, and only the
bounded read-only `verificationOnlyTools`. After refresh Chat hides every
approval, retry, recovery, app-choice, preflight, quick-reply, run-again, and
cross-surface mutation affordance; only that verification path remains.

The 2026-08-01 desktop-target hardening keeps that exact program attached to
the requested app. Chat classifies and compiles the unmodified user utterance;
dispatch prefixes are metadata only, so `Use computer:` cannot turn one exact
Photoshop workflow into two linguistic asks. The primary web composer never
auto-focuses and blurs only at the native-dispatch boundary. Before creating a
document and again after app-native status proof, the exact executor requires a
fresh window-state observation that identifies Photoshop as foreground. A
missing or contrary observation permits one semantic Photoshop focus call and
one verification read, never a coordinate fallback; pre-create failure blocks
without mutation and post-create failure remains partial/non-replayable.

Model-planned `computer_apps` turns also carry a strict `desktop_app_only`
execution-surface ceiling through both typed tool loops. Browser tools,
`desktop.open_url`, generic tool search, and browser-named launch/focus/raise
targets are unavailable in that profile. A browser is legal only when routing
selected an explicit browser or hybrid profile.

Model-planned `computer_files` turns carry a parallel `local_file_only`
ceiling. Scoped file operations, `desktop.open_path`, Preview, and non-browser
native apps remain available, but browser tools, URL opening, generic search,
and Chrome/Safari launch, focus, or window raising are rejected before
dispatch. The outer automation planner projects the canonical embedded route,
risk, and approval decision, so it cannot relabel a native/local task as a
browser task or add a redundant plan approval.

Uploaded files remain staged and return a value-free, non-executable
`desktop.open_path` handoff with no raw path or fabricated identity, approval,
receipt, or proof. The exact staged context remains in the authenticated task
prompt and is redacted from result, capability-buildout, and action-trace
telemetry.

Approval authority is exact and single-use across the audited Chat,
OpenSwan, and SwanBot lanes. Chat hashes the complete normalized plan and
user/circle/thread/room scope, then consumes `agent_approvals.applied_at`
before one transport dispatch. If a deployed project specifically reports that
the additive `applied_at` column is missing, Chat repeats the exact fingerprint
lookup without only that field and atomically consumes legacy authority through
an `approved`/`auto_approved` -> `consumed` status claim. Other database,
network, RLS, payload, or schema failures still fail closed; §10b/§28 remains
the canonical database target. The generic approval worker does not touch
runtime-owned Chat/scheduled rows, while `chat.review_comment` remains a real
worker-owned exception. OpenSwan hashes canonical tool arguments plus
authenticated persisted-run/provider-call identity and atomically stamps one
dispatch binding. SwanBot WordPress writes and the generic risk floor use that
same schema-v2 digest/claim model. Durable and model-visible payloads keep only
bounded structural labels and safe digests; raw commands, paths, values,
credentials, and canonical approval keys remain transient.

Durable OpenSwan/subagent tool-call telemetry is also value-free:
`eventBoundCore` persists only bounded field/type/shape summaries. Unknown
tool-result success payloads collapse to a value-free result schema, while
receipt metadata survives only through namespace/field/type/value allowlists.
`agentRunSystem.addStep` applies the same fresh summary at the final
`agent_run_steps` insert boundary: tool input, tool output, tool-bound
metadata/title/body, and malformed tool names are reduced to controlled
structural labels. The Run History drawer projects each whole tool step and
suppresses legacy raw name/title/body/output fields. Exact arguments and
arbitrary results remain in-memory solely for approval, dispatch, proof, and
model work; ordinary non-tool message/plan metadata/title/body keeps its
compatible shape.
`event-bound-core` is a readiness requirement and runs once in both release
gates (it was already present once in `smoke:all`).

Legacy direct local-file, image-conversion, and diagnostic launch paths return
only value-free, non-executable typed-tool handoffs. Executable
`desktop.open_path` work instead requires fresh stat/path digests, authenticated
run/provider-call identity, exact approval, a §26 claim/start, one bridge
attempt, and fresh exact frontmost-app proof; ambiguity is `outcome_unknown`
with no replay.

Typed OpenSwan and SwanBot v2 generic native input calls now share a guarded
dispatch boundary. `desktop.type_text`, `paste_text`, `press_keys`,
`menu_click`, `click_at`, the mouse move/click/down/up/drag family, and scroll
require an exact `appName` copied from `desktop.window_state` or
`desktop.observe_app`. The runtime observes the frontmost app before approval,
SHA-binds the exact args/app/PID/surface using a digest stable across a later
fresh observation of that same target, then rechecks a private one-shot guard
at handler entry before the §26 claim/start/one-attempt bridge dispatch.
Coordinate and mouse actions additionally require fresh screen bounds and a
visible exact-app window. PID, surface, bounds/window, args, TTL, clone, or
replay drift fails before mutation. These legacy endpoints return only bridge
acknowledgement, so an attempted call returns `ok: false`,
`completionVerified: false`, and `outcomeUnknown: true`, then seals
replay-blocked `outcome_unknown`; it is never reported as independently
verified completion. `desktop.set_element_value` is a separate sealed lane:
authenticated persisted run/provider call identity and one fresh full
accessibility observation bind exact app/PID/generation/dotted path/role/label
plus current/requested value hashes and lengths into a short-lived one-shot
non-secret target. A genuine exact-call approval receipt precedes one AX
set-value dispatch, and only a newer same-field observation with the requested
hash and length can complete it. Raw field values and paths stay transient;
secure, credential, payment, permission, destructive, modal, stale, drifting,
raw-dispatch, paste, and coordinate variants fail closed. Missing proof after a
possible dispatch is `outcome_unknown` and cannot replay.

`automation-executor` keeps service/scheduled invocation read-only and permits
a manual room-file write only with fresh exact one-use authority plus §26.
Every scheduled external action needs a fresh approval for its exact
occurrence, one durable claim, and one dispatch. Timeout/post-dispatch failure
persists `outcome_unknown`; Pending Actions shows a redacted verify-first state
without retry. Office Realtime is likewise not authority. After client
authentication/shape checks, §28 `invoke_agent` locks the exact durable
message/circle/expected command, checks membership and owned target/scope, and
returns canonical command/sender/targets/model. Claims are idempotent per
message/agent subject (including synthetic `blackswan`); stream/completion
writes require the same claimant, membership, live state, bounded payload, CAS,
and multi-target completion coverage. Section 28 also validates and freezes
protected schema-v2 Chat/OpenSwan approval bindings, with server-stamped
resolution and requester-only expiry/one-shot consume.

Source catalog parity is pinned at **25 server-side + 57 client-delegated = 82
total**. The added `browser.locator_actionability` lane is read-only advisory
evidence for one fresh exact browser target; it does not authorize or bind a
later mutation. `browser.dom_snapshot` redacts every editable value inside the
bridge walker, excludes hidden/inert/script/style/template/noscript descendants
from ancestor text, canonicalizes bounded roles, and exposes only controlled
field kind/state/value length. One entry/capture/exit check binds tree and title
to the same process/context/page/exact URL. Model-visible URLs are HTTP(S)
origin-only; an opaque process-HMAC URL identity lets actionability reject
exact URL or document drift without revealing userinfo, path, query, or
fragment. The identity rotates on bridge restart; every raw/forged legacy URL
identity and non-HTTP snapshot fails closed. The typed client loop remains
device-local opt-in/default-off for ordinary chat. Authenticated non-exact
app/file/hybrid computer turns require it per turn because it owns the
canonical local Photoshop/desktop catalog; bounded transient relay failures
retry, and a local loop failure cannot replay through v1 text-only chat. Ask
tools defer only to their own durable exact-call runtime approval boundary,
never to a generic plan approval. Compiler-owned exact programs are different:
their full local program and authorization mode are already fixed, so only
their post-policy handler receives execution authority. The SwanBot v1/v2 Edge
snapshot deployed on 2026-08-05, its canonical JWT modes, required secret names,
production-origin CORS, §31 Chat catalog, and §32 readiness RPC were
deployed/re-verified on 2026-08-05; the production report passed all 18 live
dependency checks. Source now normalizes complete v2 summaries across pending,
checkpoint, close/seal, cancel, failure, and terminal writers, but that source
change is not deployment proof; historical v1/v2 `agent_runs` telemetry is
still incomplete and blocks a default flip. Section 29 is authored/mirrored but
has not been
applied or live-DB verified, so encrypted resume/key rotation, claim races,
three-minute cron expiry, and historical checkpoint scrubbing remain unproven.
A live exact Photoshop run created and app-natively verified a 600x600 scratch
document while Photoshop stayed frontmost. The updated `computer-use-agent`
deployment, arbitrary native semantic input, and live Browserbase/confirmation
integration remain unproven. Its HTTP 400 response for authenticated legacy
callers without a v1 policy is intentional.

Native `desktop.launch_app` and `desktop.focus_app` also converge on one
proof-bearing helper across the app adapter, typed OpenSwan, and SwanBot v2:
fresh before/after observations, exact-or-explicit-alias resolution, positive
PID identity for running targets, no-op detection, dispatch-target checks, and
outcome-unknown/no-replay when verification is missing. A bridge
acknowledgement by itself never completes launch/focus. These reversible
lifecycle actions need no separate approval only after either the typed runtime
proves authenticated user/persisted-run/exact-provider-call identity or the
strict Chat compiler proves its immutable direct-request program and paired
local bridge. Launch proves the exact app is running; focus proves it is
running and frontmost. Neither authority path permits a browser target in the
`desktop_app_only` profile.

`/desktop diag` is a read-only bridge health/pairing/running-app probe.
`/desktop diag <app>` remains read-only too: it does not launch, focus, open,
click, or type. It returns a value-free non-executable `desktop.launch_app`
typed-runtime handoff so a fresh authenticated run can obtain exact provider
call identity, dispatch receipt, and post-launch proof. The diagnostic itself
never inherits lifecycle authority.

The verified boundary remains narrow. It covers non-submit/non-credential fill,
clearly local presentation/accessibility toggle, one exact option in a native
HTML single-value select, one exact low-consequence native semantic press, and
one exact non-secret native accessibility field value.
Eleven generic native typing, paste, keypress, menu, bounded
coordinate/mouse/scroll actions now share observe-before-approval, stable
args/app/PID/surface binding, one-shot handler-entry recheck, and §26
claim/start/one-attempt dispatch; coordinates also require live screen bounds
and a visible target-app window. SwanBot v2 no longer raw-dispatches those
browser/desktop mutations in its current client catalog. The bridge endpoints
still return only an acknowledgement, so completion is now decided by a fresh
before/after accessibility diff of the exact target app
(`src/lib/nativeUiVerificationCore.ts`) rather than by the acknowledgement:

- `verified` requires attribution, not movement. Text entry
  (`type_text`/`paste_text`) verifies only when a changed
  field value contains the exact text sent — or, when the snapshot truncated at
  `A11Y_SNAPSHOT_MAX_STRING_LENGTH`, when the sent text contains that truncated
  value. `menu_click` verifies only when a node labelled like the invoked leaf
  item appears. Unattributable tree movement never promotes to `verified`.
- `no_effect` is new and is a *proven* no-op: for the four tools that must move
  the tree, a byte-identical before/after is positive evidence the action
  missed. This replaces a blanket "unknown" that could never be improved.
- Everything else — mouse move/down/up, scroll, bare clicks, keypresses —
  stays `unknown`, because those routinely land without an accessibility-visible
  change and calling them `no_effect` would manufacture a failure.
- A missing or failed snapshot is always `unknown`; absence of evidence is never
  evidence of absence.

§26 forbids `failed` after dispatch, so a proven `no_effect` still seals
durable `outcome_unknown` and stays replay-blocked; only the user-facing text
carries the sharper truth.

The attribution requirement is not theoretical. A read-only live probe against
Google Chrome on 2026-07-29 read the same window's accessibility tree twice
back-to-back with no action performed and observed **8 changes** (+4/-4) from
ordinary background churn — a live feed plus a window title carrying memory
usage. A "the tree moved, so it worked" rule would have reported verified for
an action that was never dispatched. Repeat samples on the same idle window
produced 0 changes, so the churn is intermittent and app-dependent: the naive
rule passes local testing and then fabricates completions against any app with
live content. Both regimes produced the correct verdict (`unknown` when the
tree moved unattributably, `no_effect` when it did not move at all).

The pure policy and its runtime wiring are source/contract-verified
(`native-ui-verification-core` incl. integration cases over the real
`snapshotA11ySummary`/`diffA11ySummaries`, plus
`openswan-generic-native-ui-runtime`). The bridge read path is live-verified
read-only. No live generic native-app mutation has been executed end to end.
Accessibility value-setting is source/contract-verified through the dedicated
sealed runtime: exact generation/path/role/label/current/requested bindings,
one-shot approval and dispatch, and same-target hash/length proof. The
separately vault/origin-gated credential tool retains its own compatibility
boundary. Submit, upload, browser navigation/close, generalized native
after-state verification, future catalog additions, non-typed callers, and a
complete universal sealed gateway remain pending. Focused source/contract
smokes—including `native-semantic-value-runtime`—and app typecheck verify this
slice; current edge source is not
deployed/re-verified, §29 is not applied, and pre-deployment plaintext/legacy
pending continuations do not gain the fail-closed/scrub boundary until those
steps. No live browser/native-app GUI execution or live Postgres
contention/race proof was performed. §26 is applied and live-DB verified as of
2026-07-29 (table, RLS, grants, and fail-closed unauthenticated claim); its
concurrent-claim race behavior is still not proven. §29 remains authored and
mirrored but unapplied, so checkpoint cleanup is not an operational claim.

`src/lib/computerTaskOutcome.ts` is the source of truth for non-browser task
results. Chat may adapt its richer statuses to the older transport enum, but it
must preserve the full status in metadata and must never turn response text or
a failed adapter result into completion. Successful deterministic app
mutations without explicit fresh proof remain partial; canonical read results
are their own evidence. `src/lib/chatLaneOutcome.ts` adapts that typed terminal
for lane health without reading failure prose: approval wait is deferred,
input remains input, partial/blocked/cancelled remain blocked, and only a typed
failure is failed. Chat records this boundary for native outcomes, browser
approval continuations, cloud/local browser completion or failure, launch
failure, denial, and cancellation, so an earlier deferred preview cannot
remain the apparent terminal after the browser run finishes. Agent-only
verified tasks are currently inconclusive
because SwanBot returns text rather than a structured terminal proof signal.
Those runs preserve the real thread,
active plugins, cancellation signal, route constraints, and always-confirm
floor in `SwanBotContext`; the opt-in typed client canary consumes them, while
the default edge route remains non-cancellable. The plan-level Chat approval is
not exact tool-call consent.

The Chat dispatcher also builds one bounded immutable `chatAgentContextPack`.
Real app/file/hybrid computer runs and both app-capability retry paths pass that
pack through `AgentRunRequest`; `agentRuntime` injects its `compactPrompt` into
model context and saves a bounded projection in run metadata. Remaining
non-computer connected-agent entrypoints still need the same migration.

Unfamiliar-app capability buildout state is provider-aware. Automatic delayed
result recovery supports dedicated bounded `APP_CAPABILITY_*` receipts from
Codex and Claude Code, with exact or unique sufficiently long session matching.
The Claude bridge reconciles its transcript JSONL id to the managed launch id
only from one anchored, unambiguous UC marker; absent or conflicting claims do
not attach.
Gemini and Cursor remain general delegation providers but are excluded from
automatic capability buildout until their bridges expose the same strict result
channel; persisted legacy records without a provider retain the former Codex
interpretation.

`agentRunPersistence` now preserves typed-loop dispatch truth and bounded,
primitive-only computer action/mutation/verification receipt subsets. The
guarded browser fill/toggle/select and native semantic-press canaries emit
issued mutation-dispatch and computer-app-verification receipts into that
durable allowlist. Approval telemetry stays hidden from the model: the canonical
approval key and args are
removed and only an issued digest-safe receipt rides the runtime side channel;
the approval row itself is the durable source. Other mutations still do not
emit the complete receipt contract, so the universal gateway, stable desktop
window/document identity, and automatic observation invalidation remain
required. The transactional cross-process ledger is live as of 2026-07-29
(§26 applied); before that every guarded mutation failed closed at the claim
with `rpc_error` and was never dispatched. Concurrent-claim races remain
unproven against a live database.

Local bridge mutation authority stays loopback-bound and is remote-accessible
only through an explicitly allowlisted tunnel. The Claude, Codex, Cursor, and
Gemini bridges share source/Host/Origin checks, challenge pairing, and bearer
token validation. Claude returns the normal first pairing challenge as HTTP 200
to avoid a false browser-console failure; the client remains compatible with
rolling 428 bridges and the challenge/token security exchange is unchanged.
The Claude desktop surface additionally enforces exact file grants and denies
shell-family launchers on its fixed read-only exec-file route. Generic native
typing, paste, key, menu, and pointer calls carry a transient exact
app/PID/CGWindowID/bounds guard captured immediately before dispatch. The
native Swift helper revalidates that target during atomic type/key/paste input;
it no longer proves focus and then performs keyboard input in a separate
AppleScript process. Pointer coordinates must stay inside the sealed window,
mouse-up/scroll require x/y, and raw guards are stripped from model, approval,
receipt, durable, and serialized result surfaces. This contract is
source/compile/smoke verified; no generic native-input mutation was run live.
If a bridge is intentionally tunneled, the server must also be restarted
with `UC_BRIDGE_ALLOWED_HOSTS` set to the exact tunnel Host value and
`UC_BRIDGE_ALLOWED_ORIGINS` set to the exact browser origin; a public client URL
alone never authorizes the tunnel.

Photoshop/InDesign creative-AI work uses `src/lib/designAppCreativeAi.ts` for
text-to-image, generative fill/remove, generative expand, creative variants, and
InDesign data-merge variant planning. It also turns those capabilities into
reusable recipes such as Photoshop generated background packs, variant contact
sheets, localized cleanup, canvas expansion, InDesign frame placement, placed
image expansion, and data-merge campaign variants. It requires prompt/data
approval, target-layer/frame/selection evidence, generated-output receipts,
proof verification, and connected-agent adapter buildout when the exact Firefly
or app bridge tool is missing.

Photoshop/InDesign task execution order lives in
`src/lib/designAppExecutionPipeline.ts`. That file combines automation plans,
operation runbooks, creative-AI recipes, and adapter-gap contracts into the
shared resolve -> observe -> approve -> mutate -> export/package -> verify ->
recover pipeline used by SwanBot/OpenSwan prompts, chat handoff metadata,
persisted chat rows, and connected-agent buildout prompts.

## Memory, Skills, And Approvals

- User memory: `src/lib/userMemory.ts`.
- Agent memory/run identity: `src/lib/agentRuntimeSubject.ts` resolves stable
  subject keys and legacy aliases across Office, Chat, SwanBot, and OpenSwan;
  Office-originated SwanBot calls and v2 batch telemetry preserve the same
  subject metadata. Automation proposals, `/automation run/test`, OpenSwan
  saved automations, specialized Chat/OpenSwan mode runs, `automation-executor`,
  the Automations dashboard, Office terminal, `AgentMemoryPanel`, and
  `AgentRunsPanel` preserve or display that metadata. Pure key normalization
  lives in `src/lib/agentIdentityKey.ts`.
- Circle memory bank: `src/lib/memoryBankKinds.ts`,
  `src/lib/memoryBankChatCommands.ts`, `src/services/sharedMemory.ts`.
- Skill library: `src/lib/skillLibrary.ts`, `src/lib/skillLibraryWrite.ts`,
  `src/lib/skillPromptInjection.ts`, `circle_skills`, `circle_skill_files`.
- Checkpoints: `src/lib/chatCheckpoints.ts` and
  `src/components/ToolCallCheckpointStrip.tsx`.
- Run persistence: `src/lib/agentRunPersistence.ts`, `agent_runs`,
  `agent_run_events`, `claude_api_usage`. Tool-event persistence distinguishes
  dispatched, skipped, and legacy-unknown calls and drops arbitrary hidden
  result metadata outside bounded receipt allowlists.

Memory writes, skill writes, credential access, and destructive automation
changes must follow the HITL/approval rules in the roadmap.

## SQL And Schema

- Local migration files live in `supabase/migrations/`.
- Consolidated agent-runtime helper SQL lives in `docs/RUN_THIS_SQL.sql`.
- The roadmap SQL checklist owns applied/pending status. Do not treat a local
  migration file as proof that production has it.
- `20260726_agent_action_calls.sql` (§26) is **APPLIED and live-DB verified
  (2026-07-29)**: `agent_action_calls` exists with RLS on, one owner-read
  policy, `SELECT` to `authenticated`, and the three `claim`/`start`/`finish`
  RPCs granted to `authenticated`. A live unauthenticated claim probe returns
  structured `not_authenticated` rather than a row, so the fail-closed identity
  binding is proven against Postgres. Cross-process CONTENTION (two real
  workers racing one claim) is still unproven.
- `20260726_scheduled_action_mutation_guard.sql` is mirrored as §27 but is
  **not applied or live-DB verified**. Apply it before relying on the scheduled
  claim/dispatch/outcome-unknown state machine.
- `20260726_database_authority_guards.sql` is mirrored as §28 but is **not
  applied or live-DB verified**. Its 146-assertion source/byte-identity smoke does not prove
  Office RPC races or protected approval resolution/consumption in Postgres;
  local Docker/Supabase was unavailable for this review.
- `20260726_swanbot_continuation_privacy.sql` is mirrored as §29 but is **not
  applied or live-DB verified**. Its source checks do not prove encrypted
  continuation resume/key rotation, live claim races, cron expiry, or the
  historical scrub against Postgres.
- `20260805_messages_thread_rls_and_reactions.sql` (§31) is **applied and
  catalog-verified on the target project as of 2026-08-05**. The service-role
  contract proves the canonical table/column, four message policies, mutation
  trigger, reaction RPC grant, and Realtime publication. Authenticated
  private/shared/circle behavior, revocation, reply/reaction contention, and
  two-client Realtime delivery still need live behavioral proof. It preserves
  creator-owned bot persistence compatibility; trusted bot provenance still
  needs a later server/RPC writer.
- `20260805_openswan_production_readiness_contract.sql` (§32) is **applied and
  live-verified as of 2026-08-05**. Its service-role RPC returns booleans only;
  the report combines them with hosted function/JWT metadata, required secret
  names, production-origin reachability/CORS, source smokes/parity, and real
  telemetry. It can retrieve a service key transiently from an authenticated
  Supabase CLI when no explicit key is exported and never prints key or secret
  values.
- After schema changes, use `NOTIFY pgrst, 'reload schema';` when relevant.

Schema gotchas:

- `profiles` has no `email` column.
- `circle_office_agents` has no `model` column; owner FK is `owner_id`.
- `user_xp` primary key is `user_id`.
- `room_messages.message_type` is constrained.
- Under §31, every `messages` row has one canonical non-null `thread_id`, its
  circle/thread/reply lineage must agree, and reactions use
  `set_message_reaction` instead of whole-object replacement.
- `circle_members` RLS can recurse; use security-definer helpers where present.

## Critical Guarantees

- `src/lib/animationPatch.ts` must remain the first import in `App.tsx`.
- Frontend code uses the singleton Supabase client in `src/lib/supabase.ts`.
- New auth reads should use `safeGetUser`, `safeGetSession`, or
  `getFreshAccessToken` from `src/lib/authSession.ts`.
- If a direct `supabase.auth.getUser()` or `getSession()` call is unavoidable,
  attach `.catch(...)`.
- Do not put raw secret values in prompts, persisted chat metadata, logs, or
  activity feed entries.
- Retrieved memory, chat, or search content is untrusted. Preserve the
  roadmap's untrusted-content wrapping rules for model-visible quoted content.
- Guarded fill/toggle/select/native-semantic mutations must claim only after
  genuine authorization and record `dispatched` inside the sealed handler just
  before bridge entry. A pre-handler race loser leaves the claim reclaimable;
  a post-start error is `outcome_unknown`, never `failed`.
- Keep every SwanBot v2 client-delegated browser/desktop mutation intercepted
  by the canonical OpenSwan runtime before raw dispatch. New tools and callers
  need explicit policy/proof parity; current catalog coverage is not universal.
- A claimed edge continuation is one-way. Preserve identity/version/nonce plus
  dispatch claim id, the pre-side-effect `client_pending →
  client_dispatching` CAS, the pre-model-resume `client_dispatching →
  client_resuming` CAS, and claim-bound writes; ambiguity is `outcome_unknown`
  with no automatic replay.
- Never persist an exact SwanBot continuation snapshot or raw tool
  input/failure in public run metadata/events. Preserve the encrypted,
  ten-minute value-free envelope, explicit dedicated secret/key-version
  configuration, no-key `clientOnly` withholding, and §29 expiry/scrub
  boundary; continuation resumability is never indefinite.
- Treat approvals and Realtime events as separate trust boundaries. One exact,
  current, atomically consumed approval may authorize one dispatch; a
  broadcast may only wake a receiver that authenticates and rereads durable
  RLS state.

## Validation

The current app baseline expects `npm run typecheck` to pass.

Focused smoke scripts in `package.json` cover the main runtime areas. Prefer
the narrow script for the code you touched, for example:

```bash
npm run smoke:agent-core
npm run smoke:chat-planner
npm run smoke:computer-task-runtime
npm run smoke:cross-provider-router
npm run smoke:agent-runtime
```

The 2026-07-27 guarded-action slice is source-verified by the focused
103-assertion `agent-action-calls` ledger smoke, `agent-action-runtime-wiring`,
read-only `browser-locator-actionability`, browser fill/toggle/select,
computer-app grounding, `swanbot-v2-batch-policy`,
`swanbot-v2-continuation`, `swanbot-v2-edge-fill-schema`,
`computer-use-mutation-handoff`, `chat-recording`, readiness, and typed-runtime
invariant smokes plus app typecheck. Locator actionability remains advisory and
cannot authorize or bind a later mutation. The 2026-08-05 production contract
separately proves current v1/v2 deployment metadata, required JWT modes, secret
names, §31 catalog state, production-origin reachability, and CORS; it does not
prove Postgres contention, provider behavior, or arbitrary browser/native GUI
completion.
`openswan-generic-native-ui-runtime`, `browser-dom-snapshot-privacy`, and
`swanbot-v2-terminal-integrity` each run exactly once in both Chat/SwanBot daily
and release chains and in `smoke:all`; these are source/contract gates, not live
database, Browserbase, native-GUI, or deployed-edge proof.
The 2026-07-26 cloud/root-Chat slice is source-verified by
`computer-use-cloud-policy`, `chat-computer-request-router`, and
`computer-task-runtime-context`. The cloud-policy and runtime-context guards
run exactly once in all Chat/SwanBot daily and release gates, `smoke:all`, and
canonical readiness. Exact approval, direct-handoff, open-path, automation,
scheduled-action, Office broadcast, and database-authority guards share that
same exactly-once gate contract. This is not evidence of a deployed edge, live
Browserbase/confirmation-database integration, or live native-app execution.
`smoke:photoshop-exact-drill` runs exactly once in the Chat daily/release
commands through their matching npm `precheck:*` lifecycle hooks, and once in
`smoke:all`; the canonical `check:*` bodies do not invoke those hooks again. It
proves only compiler-manifest, drill-guardrail, and
drill source contracts. The separately required
`smoke:computer-task-runtime-context` pins the corresponding production source
contract, but the pair does not prove shared execution parity. The manual
command remains a dry
run without explicit `--live` plus the fingerprint printed by that dry run.
The one 2026-08-05 live invocation proved one create dispatch and no browser
calls; its result was established by a subsequent read-only status because the
strict immediate verification observed stale state. It does not prove
authenticated Chat, approval persistence, browser-event behavior, or a
post-retry live create.
It also does not prove §26/§27/§28/§29 application or live two-client
Realtime/RLS behavior, encrypted continuation/key-rotation or cron-expiry
behavior, concurrent claims, or external provider dispatch.

The 2026-08-05 unfamiliar-app slice is source/contract-checked by
`smoke:generic-app-navigator`, `smoke:universal-app-task-eval`,
`smoke:native-semantic-value-runtime`, launch/focus, grounding, approval, and
runtime smokes plus the desktop/local execution-surface guard and app
typecheck. The universal source corpus covers 160 requests and 7,410
assertions. This proves the typed workflow and guarded
boundaries in source; it does not prove a live generic native-app mutation,
deployed edge parity, a database contention race, or universal completion for
every human action in every app.

## Known Risk Areas

- Older code still has many direct Supabase auth calls. Do not add new unsafe
  ones; migrate to `authSession` helpers when already touching the file.
- Provider routing is multi-surface. A provider added only to the model picker
  but not `llm-proxy` or `swanbot-ai` will look selectable but fail at runtime.
- `swanbot-ai` v1 still has legacy tool-loop code. `swanbot-v2-ai` is the
  typed-loop migration target tracked in the roadmap.
- Chat persistence now stores compact metadata for source, routing, usage,
  browser plans, artifacts, memories, and execution stream. Keep payloads
  bounded to avoid oversized message rows.
- Browser and desktop actions must stay explicit about risk and approval.
- The universal browser/desktop mutation gateway remains incomplete; the five
  guarded canaries and current-catalog interception must not be generalized into a
  claim that arbitrary apps can already be operated safely end to end.
- Current SwanBot v2 deployment metadata, JWT mode, production CORS, and the
  dedicated encryption secret/key-version names were re-verified on 2026-08-05.
  §29 remains source-only until applied and live-DB verified. Old
  plaintext/legacy pending continuations fail closed or are scrubbed only after
  that migration, so rollout must still account for in-flight turns and prove
  key rotation plus claim races before the typed client becomes default.
