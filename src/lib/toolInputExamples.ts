/**
 * toolInputExamples — X4 (P47): Anthropic `input_examples` on the gnarliest
 * tool schemas.
 *
 * Why: Anthropic-measured 72%→90% accuracy on complex parameter handling
 * when tool definitions carry concrete example inputs — our worst offenders
 * are the desktop design/CAD adapters (nested arrays, enum + co-required
 * field pairs, unit-bounded numbers) and the integration writers.
 *
 * Wire facts (verified against the define-tools doc, fetched 2026-07-09):
 *   - `input_examples` is an OPTIONAL array of example input objects on the
 *     tool definition. GA — NO beta header, standard messages endpoint.
 *   - Each example MUST validate against the tool's `input_schema`; an
 *     invalid example fails the WHOLE request with a 400. That makes drift
 *     protection load-bearing: the smoke validates every curated example
 *     against the REAL registry schema, and `attachToolInputExamples`
 *     re-validates at runtime and DROPS a non-conforming example rather
 *     than sending it (fail-safe: fewer examples beat a broken tool loop).
 *   - Client tools only (ours all are); works with tool search — a deferred
 *     tool's examples expand along with its definition on discovery (P46).
 *   - Token cost ~20-200 per example → max 3 per tool, only on tools whose
 *     schemas genuinely earn them.
 *   - The swanbot-ai relay forwards `tools` verbatim; the OpenAI-shape
 *     marketplace converter maps explicit fields only, so examples are
 *     silently (and harmlessly) dropped on non-Anthropic providers.
 *
 * Curation rules: examples must be realistic for THIS app's domains
 * (dealership banners, design files, CAD parts, team integrations), must
 * exercise the confusing parts of the schema (co-required fields per enum
 * branch, nested array items, optional-field omission), and must never
 * contain secrets or real credentials.
 *
 * Pure by construction: no imports, non-mutating, bounded, never throws.
 */

export const MAX_INPUT_EXAMPLES_PER_TOOL = 3;

// ─── Curated examples ───────────────────────────────────────────────────────

export const TOOL_INPUT_EXAMPLES: Readonly<Record<string, ReadonlyArray<Record<string, unknown>>>> = {
  'desktop.indesign_batch_find_change': [
    {
      pairs: [
        { findText: '64', changeText: '65' },
        { findText: '2.9% APR', changeText: '1.9% APR' },
      ],
      expectedDocumentName: 'Spring_Banner_728x90.indd',
    },
  ],
  'desktop.indesign_batch_update_text_layers': [
    {
      updates: [
        { fieldName: 'Headline', replacementText: '2026 Silverado Blowout' },
        { fieldName: 'APR', replacementText: '1.9% APR for 60 months' },
        { fieldName: 'Disclaimer', replacementText: 'Offer ends 7/31/26. See dealer for details.' },
      ],
    },
  ],
  'desktop.indesign_update_text_layer': [
    {
      fieldName: 'Disclaimer',
      replacementText: 'Offer ends 7/31/26. Not all buyers qualify.',
      expectedDocumentName: 'Summer_Sale_300x250.indd',
    },
  ],
  'desktop.photoshop_apply_adjustment_layer': [
    { kind: 'hue_saturation', layerName: 'Hero Product', preserveExisting: true },
    // Minimal form — only the required enum; anchors at top of stack.
    { kind: 'levels' },
  ],
  'desktop.photoshop_apply_selection_or_mask': [
    { mode: 'mask_layer', layerName: 'Product Cutout', targetDocumentName: 'hero_v3.psd' },
  ],
  'desktop.photoshop_resize_canvas_or_image': [
    { op: 'canvas_resize', widthPx: 1080, heightPx: 1350, anchor: 'middle_center' },
    // image_resize with one dimension → aspect-fill.
    { op: 'image_resize', widthPx: 1920 },
  ],
  'desktop.photoshop_manage_layers': [
    { action: 'reorder', layerName: 'CTA Button', position: 'above', referenceLayerName: 'Background' },
    { action: 'rename', layerName: 'Layer 12', newName: 'Price Tag' },
  ],
  'desktop.photoshop_transform_layer': [
    { layerName: 'Price Tag', op: 'move', deltaX: 120, deltaY: -40 },
    { layerName: 'Logo', op: 'scale', scalePercent: 65 },
  ],
  'desktop.cad_compile': [
    {
      engine: 'openscad',
      sourcePath: '/Users/me/cad/bracket.scad',
      outputPath: '/Users/me/cad/bracket.stl',
      extraArgs: ['-Dthickness=4', '--render'],
    },
    {
      engine: 'blender',
      sourcePath: '/Users/me/cad/convert_to_glb.py',
      outputPath: '/Users/me/cad/part.glb',
      timeoutMs: 90000,
    },
  ],
  'wp.update_post': [
    {
      siteUrl: 'https://www.exampledealer.com',
      onePasswordItem: 'Dealer WP Admin',
      postId: 4182,
      postType: 'di_slide',
      title: 'July 4th Sales Event',
      status: 'publish',
    },
  ],
  'integration.compose_action': [
    {
      goal: 'Create a Linear issue for the checkout bug',
      method: 'POST',
      path: '/issues',
      apiName: 'Linear',
      body: { title: 'Checkout button unresponsive on mobile', teamKey: 'ENG' },
    },
  ],
  'messaging.notify': [
    {
      provider: 'slack',
      title: 'Deploy complete',
      body: 'v2.14 shipped to production — all smoke checks green.',
      fields: [
        { label: 'Status', value: 'Success' },
        { label: 'Duration', value: '4m 12s' },
      ],
    },
  ],
};

export function getToolInputExamples(toolName: string): ReadonlyArray<Record<string, unknown>> | null {
  const examples = TOOL_INPUT_EXAMPLES[toolName];
  return examples && examples.length > 0 ? examples : null;
}

// ─── Structural validation (the 400 guard) ──────────────────────────────────

type JsonSchemaLike = {
  type?: string;
  properties?: Record<string, JsonSchemaLike & { enum?: unknown[]; items?: JsonSchemaLike }>;
  required?: string[];
  enum?: unknown[];
  items?: JsonSchemaLike;
  minItems?: number;
  maxItems?: number;
};

function typeMatches(schemaType: string | undefined, value: unknown): boolean {
  if (!schemaType) return true; // untyped property (e.g. free-form body) — anything goes
  switch (schemaType) {
    case 'string': return typeof value === 'string';
    case 'number': case 'integer': return typeof value === 'number' && Number.isFinite(value);
    case 'boolean': return typeof value === 'boolean';
    case 'array': return Array.isArray(value);
    case 'object': return typeof value === 'object' && value !== null && !Array.isArray(value);
    default: return true;
  }
}

/**
 * Structural check of one example against a tool `input_schema`. Not a full
 * JSON Schema validator — it covers exactly the failure classes that would
 * 400 the request or mislead the model: unknown keys, missing required keys,
 * enum violations, wrong primitive types, array bounds, and (one level deep)
 * the same checks on object array items. Returns [] when the example passes.
 */
export function validateToolInputExample(
  schema: Record<string, unknown> | null | undefined,
  example: Record<string, unknown> | null | undefined,
): string[] {
  const problems: string[] = [];
  if (!example || typeof example !== 'object' || Array.isArray(example)) {
    return ['example is not an object'];
  }
  const s = (schema || {}) as JsonSchemaLike;
  const properties = s.properties && typeof s.properties === 'object' ? s.properties : {};
  const required = Array.isArray(s.required) ? s.required : [];

  for (const key of required) {
    if (!(key in example)) problems.push(`missing required key "${key}"`);
  }
  for (const [key, value] of Object.entries(example)) {
    const prop = properties[key];
    if (!prop) {
      problems.push(`unknown key "${key}"`);
      continue;
    }
    if (!typeMatches(prop.type, value)) {
      problems.push(`key "${key}" expected type ${prop.type}`);
      continue;
    }
    if (Array.isArray(prop.enum) && !prop.enum.includes(value)) {
      problems.push(`key "${key}" value not in enum`);
      continue;
    }
    if (prop.type === 'array' && Array.isArray(value)) {
      if (typeof prop.minItems === 'number' && value.length < prop.minItems) {
        problems.push(`key "${key}" below minItems`);
      }
      if (typeof prop.maxItems === 'number' && value.length > prop.maxItems) {
        problems.push(`key "${key}" above maxItems`);
      }
      const itemSchema = prop.items;
      if (itemSchema && itemSchema.type === 'object') {
        const itemProps = itemSchema.properties || {};
        const itemRequired = Array.isArray(itemSchema.required) ? itemSchema.required : [];
        value.forEach((item, index) => {
          if (typeof item !== 'object' || item === null || Array.isArray(item)) {
            problems.push(`key "${key}"[${index}] is not an object`);
            return;
          }
          for (const requiredKey of itemRequired) {
            if (!(requiredKey in (item as Record<string, unknown>))) {
              problems.push(`key "${key}"[${index}] missing required "${requiredKey}"`);
            }
          }
          for (const itemKey of Object.keys(item as Record<string, unknown>)) {
            if (!itemProps[itemKey]) problems.push(`key "${key}"[${index}] unknown key "${itemKey}"`);
          }
        });
      } else if (itemSchema && itemSchema.type) {
        value.forEach((item, index) => {
          if (!typeMatches(itemSchema.type, item)) {
            problems.push(`key "${key}"[${index}] expected type ${itemSchema.type}`);
          }
        });
      }
    }
  }
  return problems;
}

// ─── Attach helper (runtime fail-safe) ──────────────────────────────────────

/**
 * Decorate Anthropic-shaped tool definitions with curated `input_examples`.
 * Each example is re-validated against the def's ACTUAL schema at attach
 * time; a non-conforming example is dropped (never sent — an invalid example
 * is an API 400 for the whole request). Non-mutating; tools without curated
 * examples pass through unchanged; example count capped per tool.
 *
 * P60 optimization: validation is memoized per schema OBJECT (the registry's
 * schemas are static module constants, so identity is stable across calls;
 * the catalog chokepoint runs this every turn). Name-guarded so a shared
 * schema object between two tools can never leak the wrong examples; a
 * fresh/different schema object (tests, dynamic tools) just re-validates.
 */
const validatedExamplesMemo = new WeakMap<
  object,
  { name: string; examples: ReadonlyArray<Record<string, unknown>> | null }
>();

export function attachToolInputExamples<
  T extends { name: string; input_schema?: Record<string, unknown> },
>(defs: ReadonlyArray<T>): Array<T & { input_examples?: Array<Record<string, unknown>> }> {
  return defs.map((def) => {
    const curated = getToolInputExamples(def.name);
    if (!curated) return { ...def };

    let valid: ReadonlyArray<Record<string, unknown>> | null = null;
    const schemaKey = def.input_schema && typeof def.input_schema === 'object' ? def.input_schema : null;
    const cached = schemaKey ? validatedExamplesMemo.get(schemaKey) : undefined;
    if (cached && cached.name === def.name) {
      valid = cached.examples;
    } else {
      const computed = curated
        .filter((example) => validateToolInputExample(def.input_schema, example).length === 0)
        .slice(0, MAX_INPUT_EXAMPLES_PER_TOOL);
      valid = computed.length > 0 ? computed : null;
      if (schemaKey) validatedExamplesMemo.set(schemaKey, { name: def.name, examples: valid });
    }

    if (!valid || valid.length === 0) return { ...def };
    return { ...def, input_examples: valid.map((example) => ({ ...example })) };
  });
}
