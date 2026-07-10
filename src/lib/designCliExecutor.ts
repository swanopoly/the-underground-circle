/**
 * designCliExecutor — pure planning + validation layer for LOCAL headless
 * design-file exports (Inkscape SVG renders, Sketch document previews)
 * behind the desktop bridge's `/desktop/design_export` endpoint.
 *
 * This fulfills the "headless CLI" buildout contract in
 * docs/apps/inkscape.md and docs/apps/sketch.md using the SAME executor
 * class as `src/lib/cadCodeExecutor.ts` / `/desktop/cad_compile`:
 *   - engine 'inkscape'   → .svg source rendered to .png/.pdf/.eps via
 *                           `--export-filename` (Inkscape 1.x headless CLI)
 *   - engine 'sketchtool' → .sketch document preview exported to .png via
 *                           `sketchtool export preview` (v1 single image —
 *                           artboard-set export is a follow-up lane)
 *
 * Dependency-light on purpose: NO react-native / supabase / node imports, so
 * `npx tsx scripts/design-cli-executor-smoketest.ts` can load it directly and
 * `src/lib/desktopBridge.ts` can share the validators.
 *
 * Honest limitations (do not paper over these):
 *   - sketchtool `export preview` emits ONE document-preview image with its
 *     OWN file name (`preview.png`) into the output folder; the bridge
 *     renames the fresh preview to the requested outputPath. Per-artboard /
 *     per-layer batch export is a follow-up lane, not this one.
 *   - sketchtool preview has no per-scale multiplier like artboard export's
 *     `--scales`; the closest real control is `--max-size` (default 2048px
 *     longest edge), so scale N maps to `--max-size=2048×N`.
 *   - Inkscape `--export-width/--export-height` size the PNG raster only;
 *     PDF/EPS exports ignore them, so plans drop them (with a note) for
 *     non-PNG outputs.
 *   - Raster→raster conversion (png/jpg/webp/…) is already covered by
 *     `desktop.convert_image` — surfaced as `raster_source_use_convert_image`
 *     instead of pretending a design engine is needed.
 */

export type DesignExportEngine = 'inkscape' | 'sketchtool';
export type DesignExportOutputKind = 'png' | 'pdf' | 'eps';

// ── Extension contracts ──────────────────────────────────────────────────
// LOCKSTEP: scripts/claude-bridge.js `/desktop/design_export` duplicates
// these extension sets in its plain-JS validators (the bridge cannot import
// TS), and `designExport` in src/lib/desktopBridge.ts preflights with them.
// If you change a set here, change the bridge regexes in the same commit.
export const INKSCAPE_SOURCE_EXTENSION = 'svg';
export const INKSCAPE_OUTPUT_EXTENSIONS: readonly string[] = ['png', 'pdf', 'eps'];
export const SKETCHTOOL_SOURCE_EXTENSION = 'sketch';
export const SKETCHTOOL_OUTPUT_EXTENSIONS: readonly string[] = ['png'];

// ── Option bounds ────────────────────────────────────────────────────────
// LOCKSTEP: scripts/claude-bridge.js `validateDesignExportOptionsServer`
// mirrors these bounds/enums exactly. Keep identical.
export const DESIGN_EXPORT_DIMENSION_MIN_PX = 16;
export const DESIGN_EXPORT_DIMENSION_MAX_PX = 16384;
export const INKSCAPE_PDF_VERSIONS: readonly string[] = ['1.4', '1.5', '1.6', '1.7'];
export const SKETCHTOOL_PREVIEW_SCALES: readonly number[] = [1, 2, 3];
/** sketchtool preview's default longest-edge size; scale N → 2048×N. */
export const SKETCHTOOL_PREVIEW_BASE_MAX_SIZE_PX = 2048;

const RASTER_SOURCE_EXTENSIONS: readonly string[] = ['png', 'jpg', 'jpeg', 'webp', 'gif', 'tiff', 'tif', 'heic', 'bmp'];

/**
 * Strict dimension check for Inkscape raster sizing: a NUMBER that is an
 * integer within 16..16384. Strings ("800", "800; rm -rf /") are rejected —
 * dimensions are never coerced, so an injection attempt can never be
 * stringified into an argv token.
 */
export function isAllowedDesignExportDimension(value: unknown): value is number {
  return typeof value === 'number'
    && Number.isInteger(value)
    && value >= DESIGN_EXPORT_DIMENSION_MIN_PX
    && value <= DESIGN_EXPORT_DIMENSION_MAX_PX;
}

/** Strict sketchtool preview scale check: the NUMBER 1, 2, or 3 only. */
export function isAllowedSketchtoolPreviewScale(value: unknown): value is number {
  return typeof value === 'number' && SKETCHTOOL_PREVIEW_SCALES.includes(value);
}

/** Strict Inkscape PDF version check: one of the '1.4'..'1.7' literals. */
export function isAllowedInkscapePdfVersion(value: unknown): value is string {
  return typeof value === 'string' && INKSCAPE_PDF_VERSIONS.includes(value);
}

// ── Path validation (pure mirror) ────────────────────────────────────────
// LOCKSTEP: mirrors `validateDesktopPathServer` in scripts/claude-bridge.js
// (length/control-char/shell-metachar rejects) so a plan that passes here
// cannot fail bridge validation for a different reason. Paths only ever
// reach execFile argv — never a shell string, never generated code.
function validateDesignPath(raw: unknown): { ok: true; path: string } | { ok: false; error: string } {
  if (typeof raw !== 'string') return { ok: false, error: 'path must be a string' };
  const trimmed = raw.trim();
  if (!trimmed) return { ok: false, error: 'path is empty' };
  if (trimmed.length > 1024) return { ok: false, error: 'path exceeds 1024 chars' };
  // eslint-disable-next-line no-control-regex
  if (/[\x00-\x1f]/.test(trimmed)) return { ok: false, error: 'path contains control characters' };
  if (/[`$;|&><\n]/.test(trimmed)) return { ok: false, error: 'path contains shell metacharacter' };
  return { ok: true, path: trimmed };
}

function extensionOf(pathValue: string): string {
  const match = /\.([A-Za-z0-9]{1,12})$/.exec(String(pathValue || '').trim());
  return match ? match[1].toLowerCase() : '';
}

function normalizeExt(raw: unknown): string {
  return String(raw ?? '').trim().toLowerCase().replace(/^\./, '').slice(0, 12);
}

// ── Options (per-engine strict allowlist) ────────────────────────────────

export interface DesignExportOptions {
  /** Inkscape only — PNG raster width in px (integer 16..16384). */
  widthPx?: number;
  /** Inkscape only — PNG raster height in px (integer 16..16384). */
  heightPx?: number;
  /** Inkscape only — PDF version pin; emitted only for .pdf outputs. */
  pdfVersion?: string;
  /** sketchtool only — preview format; PNG is the only supported value. */
  format?: 'png';
  /** sketchtool only — 1|2|3, mapped to `--max-size=2048×scale`. */
  scale?: number;
}

export type DesignExportOptionsValidation =
  | { ok: true; options: DesignExportOptions }
  | { ok: false; error: string };

/**
 * Strict per-engine options gate used by BOTH the desktopBridge client
 * preflight and (duplicated in plain JS) the bridge endpoint itself.
 * Unknown keys, cross-engine keys, non-integer/out-of-range dimensions,
 * string-typed numbers, and unknown enums are all hard rejects — options
 * never get coerced into argv tokens.
 * LOCKSTEP: scripts/claude-bridge.js `validateDesignExportOptionsServer`.
 */
export function validateDesignExportOptions(engine: DesignExportEngine, raw: unknown): DesignExportOptionsValidation {
  if (raw === undefined || raw === null) return { ok: true, options: {} };
  if (typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, error: 'options must be an object.' };
  const record = raw as Record<string, unknown>;
  const allowedKeys = engine === 'inkscape' ? ['widthPx', 'heightPx', 'pdfVersion'] : ['format', 'scale'];
  for (const key of Object.keys(record)) {
    if (!allowedKeys.includes(key)) {
      return { ok: false, error: `options.${key} is not allowed for engine "${engine}". Allowed: ${allowedKeys.join(', ')}.` };
    }
  }
  const options: DesignExportOptions = {};
  if (engine === 'inkscape') {
    for (const key of ['widthPx', 'heightPx'] as const) {
      const value = record[key];
      if (value === undefined || value === null) continue;
      if (!isAllowedDesignExportDimension(value)) {
        return { ok: false, error: `options.${key} must be an integer ${DESIGN_EXPORT_DIMENSION_MIN_PX}..${DESIGN_EXPORT_DIMENSION_MAX_PX}.` };
      }
      options[key] = value;
    }
    const pdfVersion = record.pdfVersion;
    if (pdfVersion !== undefined && pdfVersion !== null) {
      if (!isAllowedInkscapePdfVersion(pdfVersion)) {
        return { ok: false, error: `options.pdfVersion must be one of: ${INKSCAPE_PDF_VERSIONS.join(', ')}.` };
      }
      options.pdfVersion = pdfVersion;
    }
    return { ok: true, options };
  }
  const format = record.format;
  if (format !== undefined && format !== null) {
    if (format !== 'png') {
      return { ok: false, error: 'options.format must be "png" — sketchtool preview export is PNG-only.' };
    }
    options.format = 'png';
  }
  const scale = record.scale;
  if (scale !== undefined && scale !== null) {
    if (!isAllowedSketchtoolPreviewScale(scale)) {
      return { ok: false, error: `options.scale must be one of: ${SKETCHTOOL_PREVIEW_SCALES.join(', ')}.` };
    }
    options.scale = scale;
  }
  return { ok: true, options };
}

// ── Engine resolution ────────────────────────────────────────────────────

export type DesignExportEngineResolution = DesignExportEngine | { unsupported: true; reason: string };

/**
 * Pick the local design engine for a source→output pair, or say honestly why
 * none fits. Inkscape renders .svg to .png/.pdf/.eps; sketchtool exports a
 * .sketch document preview to .png. Raster sources are deliberately NOT here
 * — `desktop.convert_image` already covers raster↔raster, so that surfaces
 * as `raster_source_use_convert_image` rather than a fake design lane.
 */
export function resolveDesignExportEngine(args: { sourceExt: string; outputExt: string }): DesignExportEngineResolution {
  const source = normalizeExt(args?.sourceExt);
  const output = normalizeExt(args?.outputExt);
  if (!source) return { unsupported: true, reason: 'missing_source_extension' };
  if (source === INKSCAPE_SOURCE_EXTENSION) {
    if (INKSCAPE_OUTPUT_EXTENSIONS.includes(output)) return 'inkscape';
    return { unsupported: true, reason: 'inkscape_output_not_supported' };
  }
  if (source === SKETCHTOOL_SOURCE_EXTENSION) {
    if (SKETCHTOOL_OUTPUT_EXTENSIONS.includes(output)) return 'sketchtool';
    return { unsupported: true, reason: 'sketchtool_output_not_supported' };
  }
  if (RASTER_SOURCE_EXTENSIONS.includes(source)) {
    return { unsupported: true, reason: 'raster_source_use_convert_image' };
  }
  return { unsupported: true, reason: 'unsupported_source_format' };
}

// ── Export plan ──────────────────────────────────────────────────────────

export interface DesignExportPlanArgs {
  /** Path to the .svg or .sketch source document. */
  sourcePath: string;
  /** Desired output kind: png/pdf/eps for svg sources, png for .sketch. */
  outputKind: DesignExportOutputKind | string;
  /** Inkscape PNG raster width (integer 16..16384). */
  widthPx?: number;
  /** Inkscape PNG raster height (integer 16..16384). */
  heightPx?: number;
  /** sketchtool preview scale 1|2|3 (→ --max-size 2048×scale). */
  scale?: number;
}

export type DesignExportPlan =
  | {
      ok: true;
      engine: DesignExportEngine;
      sourcePath: string;
      /** Source path with the output extension swapped in (same folder). */
      outputPath: string;
      /** Validated options ready to pass to designExport / the bridge. */
      options: DesignExportOptions;
      notes: string[];
    }
  | { ok: false; reason: string; notes: string[] };

/**
 * Deterministic export plan (same inputs → same plan; no Date.now): resolves
 * the engine from the source/output extensions, derives the default
 * outputPath beside the source, and validates option values with the SAME
 * bounds the bridge enforces. Invalid options are dropped with an
 * explanatory note — never silently mangled into a request value.
 */
export function buildDesignExportPlan(args: DesignExportPlanArgs): DesignExportPlan {
  const notes: string[] = [];
  const sourceValidated = validateDesignPath(args?.sourcePath);
  if (!sourceValidated.ok) {
    return { ok: false, reason: `sourcePath: ${sourceValidated.error}`, notes };
  }
  const sourcePath = sourceValidated.path;
  const sourceExt = extensionOf(sourcePath);
  const outputKind = normalizeExt(args?.outputKind);
  const resolution = resolveDesignExportEngine({ sourceExt, outputExt: outputKind });
  if (typeof resolution !== 'string') {
    if (resolution.reason === 'raster_source_use_convert_image') {
      notes.push('Raster→raster conversion is already covered by desktop.convert_image — no design engine is needed.');
    }
    if (resolution.reason === 'sketchtool_output_not_supported') {
      notes.push('sketchtool v1 exports the document preview as PNG only; artboard/PDF export is a follow-up lane.');
    }
    return { ok: false, reason: resolution.reason, notes };
  }
  const engine = resolution;
  // Swap the source extension for the output kind (engine resolution already
  // guarantees outputKind ≠ sourceExt, so outputPath never equals sourcePath).
  const outputPath = `${sourcePath.slice(0, sourcePath.length - sourceExt.length - 1)}.${outputKind}`;
  const options: DesignExportOptions = {};

  if (engine === 'inkscape') {
    for (const key of ['widthPx', 'heightPx'] as const) {
      const value = args?.[key];
      if (value === undefined || value === null) continue;
      if (!isAllowedDesignExportDimension(value)) {
        notes.push(`Dropped ${key} "${String(value).slice(0, 40)}": must be an integer ${DESIGN_EXPORT_DIMENSION_MIN_PX}..${DESIGN_EXPORT_DIMENSION_MAX_PX}.`);
        continue;
      }
      if (outputKind !== 'png') {
        notes.push(`Dropped ${key}: Inkscape width/height size the PNG raster only — ${outputKind} exports ignore them.`);
        continue;
      }
      options[key] = value;
    }
    if (args?.scale !== undefined && args?.scale !== null) {
      notes.push('Dropped scale: scale applies to the sketchtool preview lane only.');
    }
    if (outputKind === 'pdf') {
      notes.push(`PDF exports may pin a version via options.pdfVersion (${INKSCAPE_PDF_VERSIONS.join(', ')}); default is Inkscape's own.`);
    }
    notes.push(`Run via desktop design_export { engine: "inkscape" } — headless Inkscape 1.x CLI (--export-filename), no GUI, fixed binary path.`);
  } else {
    options.format = 'png';
    if (args?.scale !== undefined && args?.scale !== null) {
      if (isAllowedSketchtoolPreviewScale(args.scale)) {
        options.scale = args.scale;
      } else {
        notes.push(`Dropped scale "${String(args.scale).slice(0, 40)}": must be one of ${SKETCHTOOL_PREVIEW_SCALES.join(', ')}.`);
      }
    }
    if ((args?.widthPx !== undefined && args?.widthPx !== null) || (args?.heightPx !== undefined && args?.heightPx !== null)) {
      notes.push(`Dropped widthPx/heightPx: the sketchtool preview lane has no pixel dimensions — use scale 1|2|3 (--max-size ${SKETCHTOOL_PREVIEW_BASE_MAX_SIZE_PX}×scale).`);
    }
    notes.push('sketchtool v1 exports the DOCUMENT PREVIEW image (last-edited page), not an artboard set — artboard batch export is a follow-up lane.');
    notes.push('sketchtool writes its own preview.png into the output folder; the bridge renames the fresh preview to outputPath and verifies it.');
  }
  notes.push('Output goes to a NEW path — adjust outputPath before approval if a file already exists there; never overwrite the source document.');
  return { ok: true, engine, sourcePath, outputPath, options, notes };
}

// ── Install guidance ─────────────────────────────────────────────────────

/** One-line plain-language install hint per engine. */
export function describeDesignExportInstallGuidance(engine: DesignExportEngine): string {
  if (engine === 'sketchtool') {
    return 'Sketch (which bundles sketchtool) is not installed on this Mac — install Sketch from sketch.com, then retry the export.';
  }
  return 'Inkscape is not installed on this Mac — install it with `brew install --cask inkscape` (or from inkscape.org), then retry the export.';
}

// ── Export receipt (bounded evidence for persisted metadata) ─────────────

export interface DesignExportReceipt {
  engine: string;
  exitOk: boolean;
  outputExists: boolean;
  outputBytes: number;
  durationMs: number;
  stderrExcerpt: string;
}

/**
 * Reduce a `/desktop/design_export` response (bridge body or client `data`)
 * into the bounded receipt shape safe for persisted chat metadata /
 * evidence contracts. Tolerates missing/garbage fields — never throws.
 * (Same bounds as buildCadCompileReceipt in cadCodeExecutor.ts.)
 */
export function buildDesignExportReceipt(bridgeResult: unknown): DesignExportReceipt {
  const record = bridgeResult && typeof bridgeResult === 'object' ? (bridgeResult as Record<string, unknown>) : {};
  const output = record.output && typeof record.output === 'object' ? (record.output as Record<string, unknown>) : {};
  const bytes = Number(output.bytes);
  const duration = Number(record.durationMs);
  return {
    engine: String(record.engine || 'unknown').slice(0, 40),
    // Strict: receipts are persisted evidence — only a literal numeric 0
    // exit counts as success (no string coercion).
    exitOk: record.exitCode === 0,
    outputExists: output.exists === true,
    outputBytes: Number.isFinite(bytes) ? Math.max(0, Math.min(1_000_000_000_000, Math.trunc(bytes))) : 0,
    durationMs: Number.isFinite(duration) ? Math.max(0, Math.min(86_400_000, Math.trunc(duration))) : 0,
    stderrExcerpt: String(record.stderrTail || '').slice(-300),
  };
}
