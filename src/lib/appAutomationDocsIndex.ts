/**
 * appAutomationDocsIndex — registry mapping desktop/design/engineering apps
 * to their canonical automation profile docs under docs/apps/.
 *
 * Each profile doc is the single source of truth for "what can chat actually
 * automate in this app": executable tool names, ranked control surfaces,
 * recipes, approval/evidence rules, gaps, and official refs. This index makes
 * those docs load-bearing: connected-agent capability buildouts get pointed
 * at the app's profile before writing any code, and status here must match
 * the doc header's `Status:` line (LOCKSTEP by review, pinned by smoke).
 *
 * Pure module (no runtime imports) — smoke: scripts/app-automation-docs-index-smoketest.ts
 */

export type AppAutomationDocStatus =
  | 'executable'
  | 'partial'
  | 'buildout_only'
  | 'web_only'
  | 'cloud_service';

export interface AppAutomationDocEntry {
  slug: string;
  appName: string;
  status: AppAutomationDocStatus;
  /** Lowercase substrings that identify the app in a task/app name. Checked
   *  with word-ish boundaries; longer aliases win over shorter ones. */
  aliases: string[];
  docPath: string;
}

function entry(
  slug: string,
  appName: string,
  status: AppAutomationDocStatus,
  aliases: string[],
): AppAutomationDocEntry {
  return { slug, appName, status, aliases, docPath: `docs/apps/${slug}.md` };
}

/** Ordered registry — one row per profile doc in docs/apps/. */
export const APP_AUTOMATION_DOCS: AppAutomationDocEntry[] = [
  // Adobe / creative
  entry('photoshop', 'Adobe Photoshop', 'executable', ['photoshop', '.psd', 'psd file']),
  entry('indesign', 'Adobe InDesign', 'executable', ['indesign', '.indd', 'data merge']),
  entry('illustrator', 'Adobe Illustrator', 'executable', ['illustrator', '.ai file']),
  entry('after-effects', 'Adobe After Effects', 'buildout_only', ['after effects', 'aftereffects', '.aep']),
  entry('premiere-pro', 'Adobe Premiere Pro', 'buildout_only', ['premiere', '.prproj']),
  entry('lightroom-classic', 'Adobe Lightroom Classic', 'buildout_only', ['lightroom']),
  entry('acrobat', 'Adobe Acrobat', 'buildout_only', ['acrobat']),
  entry('firefly-services', 'Adobe Firefly Services', 'cloud_service', ['firefly']),
  // CAD / engineering
  entry('autocad', 'AutoCAD', 'partial', ['autocad', '.dwg', 'autolisp']),
  entry('fusion-360', 'Autodesk Fusion 360', 'buildout_only', ['fusion 360', 'fusion360', '.f3d']),
  entry('solidworks', 'SOLIDWORKS', 'buildout_only', ['solidworks', '.sldprt', '.sldasm']),
  entry('freecad', 'FreeCAD', 'executable', ['freecad', '.fcstd']),
  entry('openscad', 'OpenSCAD', 'executable', ['openscad', '.scad']),
  entry('onshape', 'Onshape', 'cloud_service', ['onshape', 'featurescript']),
  entry('revit', 'Autodesk Revit', 'buildout_only', ['revit', '.rvt', ' bim ']),
  entry('inventor', 'Autodesk Inventor', 'buildout_only', ['inventor', '.ipt', 'ilogic']),
  entry('rhino', 'Rhino 3D', 'partial', ['rhino', 'rhinoceros', '.3dm', 'grasshopper']),
  entry('matlab-simulink', 'MATLAB / Simulink', 'partial', ['matlab', 'simulink', '.slx']),
  entry('kicad', 'KiCad', 'buildout_only', ['kicad', '.kicad_pcb', 'gerber']),
  entry('sketchup', 'SketchUp', 'buildout_only', ['sketchup', '.skp']),
  // Other design / 3D / video
  entry('figma', 'Figma', 'web_only', ['figma']),
  entry('sketch', 'Sketch', 'partial', ['sketch app', 'sketchtool', '.sketch']),
  entry('affinity-designer', 'Affinity Designer', 'partial', ['affinity designer', '.afdesign']),
  entry('affinity-photo', 'Affinity Photo', 'partial', ['affinity photo', '.afphoto']),
  entry('canva', 'Canva', 'web_only', ['canva']),
  entry('gimp', 'GIMP', 'buildout_only', ['gimp', 'script-fu', '.xcf']),
  entry('inkscape', 'Inkscape', 'partial', ['inkscape']),
  entry('davinci-resolve', 'DaVinci Resolve', 'buildout_only', ['davinci', 'resolve studio', '.drp']),
  entry('blender', 'Blender', 'executable', ['blender', '.blend', 'bpy']),
  entry('cinema-4d', 'Cinema 4D', 'buildout_only', ['cinema 4d', 'cinema4d', '.c4d']),
  entry('maya', 'Autodesk Maya', 'buildout_only', ['maya', '.mb file', '.ma file', 'mayapy']),
];

const BOUNDARY_SAFE = /[a-z0-9]/;

function matchesAlias(haystack: string, alias: string): boolean {
  let from = 0;
  while (from <= haystack.length - alias.length) {
    const idx = haystack.indexOf(alias, from);
    if (idx === -1) return false;
    const before = idx > 0 ? haystack[idx - 1] : '';
    const after = idx + alias.length < haystack.length ? haystack[idx + alias.length] : '';
    // Word-ish boundaries: the char before/after must not extend the token.
    // Aliases that start/end with punctuation (".psd") skip that side's check.
    const beforeOk = !BOUNDARY_SAFE.test(alias[0]) || !BOUNDARY_SAFE.test(before || ' ');
    const afterOk = !BOUNDARY_SAFE.test(alias[alias.length - 1]) || !BOUNDARY_SAFE.test(after || ' ');
    if (beforeOk && afterOk) return true;
    from = idx + 1;
  }
  return false;
}

/**
 * Resolves the app automation profile doc for a task string and/or explicit
 * app name. Longest matching alias wins (so "affinity designer" beats a
 * hypothetical "designer"). Returns null when nothing matches — callers must
 * treat that as "no profile yet", not an error.
 */
export function resolveAppAutomationDoc(
  taskOrAppName: string | null | undefined,
  explicitAppName?: string | null,
): AppAutomationDocEntry | null {
  const haystacks = [explicitAppName, taskOrAppName]
    .map((value) => (typeof value === 'string' ? value.trim().toLowerCase() : ''))
    .filter(Boolean);
  if (haystacks.length === 0) return null;
  let bestEntry: AppAutomationDocEntry | null = null;
  let bestAliasLength = 0;
  for (const haystack of haystacks) {
    for (const doc of APP_AUTOMATION_DOCS) {
      for (const alias of doc.aliases) {
        if (alias.length <= bestAliasLength) continue;
        if (matchesAlias(haystack, alias)) {
          bestEntry = doc;
          bestAliasLength = alias.length;
        }
      }
    }
    // Explicit app name is authoritative — if it matched anything, stop.
    if (bestEntry && haystack === haystacks[0] && haystacks.length > 1) break;
  }
  return bestEntry;
}

/** One prompt line pointing a buildout/connected agent at the profile doc. */
export function buildAppAutomationDocPromptLine(
  taskOrAppName: string | null | undefined,
  explicitAppName?: string | null,
): string | null {
  const doc = resolveAppAutomationDoc(taskOrAppName, explicitAppName);
  if (!doc) return null;
  return `App automation profile: read ${doc.docPath} FIRST — it is the canonical record of ${doc.appName}'s executable tools, control surfaces, approval rules, and known gaps (status: ${doc.status}).`;
}
