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
  properties?: Record<string, JsonSchemaLike>;
  required?: string[];
  enum?: unknown[];
  items?: JsonSchemaLike;
  minItems?: number;
  maxItems?: number;
};

/**
 * Nested-validation depth bound. `depth` counts container levels below the
 * example root (root object = 0, its property values = 1, their items /
 * sub-properties = 2, ...). Scalar checks (type, enum, array bounds) run on
 * values through depth 4; a container AT depth 4 does not have its children
 * enumerated (they pass unvalidated). Curated examples are ≤3 levels deep
 * today — the bound exists to keep the validator O(size) and terminating
 * even on pathological or cyclic schemas/values, never to skip real checks.
 */
export const MAX_NESTED_VALIDATION_DEPTH = 4;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function typeMatches(schemaType: string | undefined, value: unknown): boolean {
  if (!schemaType) return true; // untyped property (e.g. free-form body) — anything goes
  switch (schemaType) {
    case 'string': return typeof value === 'string';
    case 'number': case 'integer': return typeof value === 'number' && Number.isFinite(value);
    case 'boolean': return typeof value === 'boolean';
    case 'array': return Array.isArray(value);
    case 'object': return isPlainObject(value);
    default: return true;
  }
}

/**
 * Validate one value against one (sub-)schema node. Type/enum/array-bound
 * checks always run; descent into array items and object properties stops at
 * MAX_NESTED_VALIDATION_DEPTH. Problem paths read like
 * `key "pairs"[0] missing required "changeText"` or
 * `key "target".geometry expected type number`.
 */
function validateValueAgainstSchema(
  prop: JsonSchemaLike | null | undefined,
  value: unknown,
  path: string,
  depth: number,
  problems: string[],
): void {
  if (!prop || typeof prop !== 'object' || Array.isArray(prop)) return; // no usable constraints declared
  if (!typeMatches(prop.type, value)) {
    problems.push(`${path} expected type ${prop.type}`);
    return;
  }
  if (Array.isArray(prop.enum) && !prop.enum.includes(value)) {
    problems.push(`${path} value not in enum`);
    return;
  }
  if (Array.isArray(value)) {
    if (typeof prop.minItems === 'number' && value.length < prop.minItems) {
      problems.push(`${path} below minItems`);
    }
    if (typeof prop.maxItems === 'number' && value.length > prop.maxItems) {
      problems.push(`${path} above maxItems`);
    }
    const itemSchema = prop.items;
    if (itemSchema && typeof itemSchema === 'object' && depth < MAX_NESTED_VALIDATION_DEPTH) {
      value.forEach((item, index) => {
        validateValueAgainstSchema(itemSchema, item, `${path}[${index}]`, depth + 1, problems);
      });
    }
    return;
  }
  if (isPlainObject(value) && depth < MAX_NESTED_VALIDATION_DEPTH) {
    validateObjectAgainstSchema(prop, value, path, depth, problems);
  }
}

/**
 * Validate an object's keys against an object (sub-)schema node. `required`
 * is enforced whenever declared. Unknown-key checks apply ONLY when the node
 * declares a `properties` map — a free-form object schema (no `properties`,
 * e.g. integration.compose_action's `body`) accepts arbitrary keys/values.
 * `depth` is the container depth of `value` itself; its children are
 * validated at depth + 1.
 */
function validateObjectAgainstSchema(
  schema: JsonSchemaLike,
  value: Record<string, unknown>,
  path: string, // '' when `value` is the example root
  depth: number,
  problems: string[],
): void {
  const declaredProps: Record<string, JsonSchemaLike> | null =
    schema.properties && typeof schema.properties === 'object' && !Array.isArray(schema.properties)
      ? schema.properties
      : null;
  const required = Array.isArray(schema.required) ? schema.required : [];
  const atRoot = path === '';

  for (const key of required) {
    if (!(key in value)) {
      problems.push(atRoot ? `missing required key "${key}"` : `${path} missing required "${key}"`);
    }
  }
  for (const [key, entry] of Object.entries(value)) {
    const prop = declaredProps && Object.prototype.hasOwnProperty.call(declaredProps, key)
      ? declaredProps[key]
      : undefined;
    if (declaredProps && prop === undefined) {
      problems.push(atRoot ? `unknown key "${key}"` : `${path} unknown key "${key}"`);
      continue;
    }
    validateValueAgainstSchema(prop, entry, atRoot ? `key "${key}"` : `${path}.${key}`, depth + 1, problems);
  }
}

/**
 * Structural check of one example against a tool `input_schema`. Not a full
 * JSON Schema validator — it covers exactly the failure classes that would
 * 400 the request or mislead the model: unknown keys (only where the schema
 * declares a `properties` map — free-form/untyped object properties pass),
 * missing required keys, enum violations, wrong primitive types, and array
 * bounds — applied RECURSIVELY through nested object properties and array
 * items down to MAX_NESTED_VALIDATION_DEPTH container levels. Returns []
 * when the example passes. Never throws; cyclic schemas or values terminate
 * at the depth bound.
 */
export function validateToolInputExample(
  schema: Record<string, unknown> | null | undefined,
  example: Record<string, unknown> | null | undefined,
): string[] {
  const problems: string[] = [];
  if (!example || typeof example !== 'object' || Array.isArray(example)) {
    return ['example is not an object'];
  }
  const s = (schema && typeof schema === 'object' && !Array.isArray(schema) ? schema : {}) as JsonSchemaLike;
  validateObjectAgainstSchema(s, example as Record<string, unknown>, '', 0, problems);
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
