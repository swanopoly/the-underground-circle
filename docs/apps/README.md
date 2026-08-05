# App Automation Profiles

> One file per app: what chat can ACTUALLY automate, through which control
> surface, with which approval/evidence rules, and what's honestly still a
> gap. Created P16 (2026-07-06).
>
> Machine-readable index: `src/lib/appAutomationDocsIndex.ts` — statuses here
> and in each file's header are pinned in lockstep by
> `npm run smoke:app-automation-docs-index`. Connected-agent capability
> buildouts are pointed at the matching profile automatically
> (`buildAppAutomationDocPromptLine` in `agentAppCapabilityBuildout.ts`).

Statuses: **executable** (real bridge tools ship today) · **partial** (some
real lanes + ladder) · **buildout-only** (generic ladder + buildout path) ·
**web-only** (browser pipeline) · **cloud-service** (HTTP API, adapter
deferred).

| App | Status | Fastest real lane today |
|---|---|---|
| [Photoshop](photoshop.md) | executable | 12 `desktop.photoshop_*` ExtendScript tools |
| [InDesign](indesign.md) | executable | 9 `desktop.indesign_*` tools |
| [Illustrator](illustrator.md) | partial | `desktop.illustrator_document_status` / `_export_proof` (P16) |
| [After Effects](after-effects.md) | buildout-only | ladder; `aerender` CLI is the buildout target |
| [Premiere Pro](premiere-pro.md) | buildout-only | ladder; resident UXP plugin is the buildout target |
| [Lightroom Classic](lightroom-classic.md) | buildout-only | ladder; Lua SDK plugin buildout |
| [Acrobat](acrobat.md) | buildout-only | ladder; prefer local file tools for PDFs |
| [Firefly Services](firefly-services.md) | cloud-service | deferred (enterprise-gated API) |
| [AutoCAD](autocad.md) | partial | typed commands + `desktop.cad_inspect_file` for DXF |
| [Fusion 360](fusion-360.md) | buildout-only | ladder; exports feed local CAD tools |
| [SOLIDWORKS](solidworks.md) | buildout-only | Windows-only API; STEP exports inspectable |
| [FreeCAD](freecad.md) | executable | `desktop.cad_compile` engine `freecadcmd` |
| [OpenSCAD](openscad.md) | executable | `desktop.cad_compile` engine `openscad` |
| [Onshape](onshape.md) | cloud-service | browser pipeline; REST executor deferred (2,500 calls/yr cap) |
| [Revit](revit.md) | buildout-only | Windows-only; exports only |
| [Inventor](inventor.md) | buildout-only | Windows-only; exports only |
| [Rhino](rhino.md) | partial | typed commands; `rhinocode` CLI buildout target |
| [MATLAB / Simulink](matlab-simulink.md) | partial | MATLAB MCP when installed; `matlab -batch` buildout |
| [KiCad](kicad.md) | buildout-only | `kicad-cli` is the strong buildout target |
| [SketchUp](sketchup.md) | buildout-only | ladder; exported meshes → blender lanes |
| [Figma](figma.md) | web-only | browser pipeline; REST/MCP adapter later |
| [Sketch](sketch.md) | partial | `desktop.design_export` engine `sketchtool` (document preview → PNG; artboard batch is a follow-up) |
| [Affinity Designer](affinity-designer.md) | partial | a11y/menu ladder (no public API — honest ceiling) |
| [Affinity Photo](affinity-photo.md) | partial | a11y ladder + `desktop.convert_image` for plain conversions |
| [Canva](canva.md) | web-only | browser pipeline; Connect API adapter later |
| [GIMP](gimp.md) | buildout-only | headless `gimp -i -b` is the buildout target |
| [Inkscape](inkscape.md) | partial | `desktop.design_export` engine `inkscape` (svg → png/pdf/eps) |
| [DaVinci Resolve](davinci-resolve.md) | buildout-only | Python API (Studio-only) buildout |
| [Blender](blender.md) | executable | `desktop.cad_compile` engine `blender` (P16) |
| [Cinema 4D](cinema-4d.md) | buildout-only | Commandline render / `c4dpy` buildout (license-gated) |
| [Maya](maya.md) | buildout-only | `mayapy` / `Render` CLI buildout |

## Adding an app

1. Write `docs/apps/<slug>.md` on the shared template (see any file here:
   Status header → What chat can do today → Control surfaces → Recipes →
   Approval & evidence rules → Gaps & buildout → Source refs). ≤120 lines,
   exact registered tool names only, honest about ceilings.
2. Register it in `src/lib/appAutomationDocsIndex.ts` (slug, aliases,
   status matching the header).
3. Run `npm run smoke:app-automation-docs-index` — it fails on missing
   files, status drift, or alias collisions.
