/**
 * tool-input-examples-smoketest — verifies the X4 (P47) curated
 * `input_examples` in `src/lib/toolInputExamples.ts`.
 *
 * The load-bearing case: EVERY curated example is validated against the
 * REAL tool schema from the live catalog (`listOpenSwanAnthropicToolsForSurface`)
 * — an example that drifts from its schema would 400 every tool-loop request,
 * so schema drift MUST fail this smoke, not production.
 *
 * Also covers: the structural validator's failure classes (unknown key,
 * missing required, enum violation, type mismatch, array bounds, nested item
 * checks), RECURSIVE nested-object validation (required/unknown/enum/type
 * violations inside object-typed properties, free-form objects still pass,
 * 4-level depth bound, cyclic-input termination), the attach helper's
 * fail-safe drop + non-mutation + cap, and the chokepoint integration
 * (catalog defs actually carry input_examples).
 *
 * `openswanToolRuntime` transitively imports react-native (via the supabase
 * singleton) — same registerHooks stub technique as
 * tool-description-lint-smoketest so the validation runs against the live
 * catalog, not a fixture.
 *
 * Run: npm run smoke:tool-input-examples
 */

import { registerHooks } from 'node:module';

process.env.EXPO_PUBLIC_SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL || 'https://tool-examples-smoke.invalid.supabase.co';
process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || 'tool-examples-smoke-anon-key';

const NATIVE_STUBS = new Set(['react-native', '@react-native-async-storage/async-storage']);
const STUB_URL = new URL('./native-module-stub.mjs', import.meta.url).href;

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (NATIVE_STUBS.has(specifier)) return { url: STUB_URL, shortCircuit: true };
    return nextResolve(specifier, context);
  },
});

let failures = 0;
function fail(m: string) { failures += 1; console.error('FAIL:', m); }
function pass(m: string) { console.log('pass:', m); }
function assert(cond: any, name: string, detail?: string) {
  if (cond) pass(name);
  else fail(`${name}${detail ? ' — ' + detail : ''}`);
}

async function main() {
  const {
    TOOL_INPUT_EXAMPLES,
    MAX_INPUT_EXAMPLES_PER_TOOL,
    MAX_NESTED_VALIDATION_DEPTH,
    validateToolInputExample,
    attachToolInputExamples,
    getToolInputExamples,
  } = await import('../src/lib/toolInputExamples');
  const { listOpenSwanAnthropicToolsForSurface } = await import('../src/lib/openswanToolRuntime');

  // ─── Case 1: EVERY curated example validates against its LIVE schema ────
  {
    const surfaces = ['main_chat', 'room_chat', 'office', 'task_run'] as const;
    const liveDefs = new Map<string, Record<string, unknown>>();
    for (const surface of surfaces) {
      for (const def of listOpenSwanAnthropicToolsForSurface(surface)) {
        if (!liveDefs.has(def.name)) liveDefs.set(def.name, def.input_schema);
      }
    }
    for (const [toolName, examples] of Object.entries(TOOL_INPUT_EXAMPLES)) {
      const schema = liveDefs.get(toolName);
      assert(!!schema, `case1: curated tool "${toolName}" exists in the live catalog`);
      if (!schema) continue;
      assert(examples.length >= 1 && examples.length <= MAX_INPUT_EXAMPLES_PER_TOOL,
        `case1: "${toolName}" example count within cap`);
      examples.forEach((example, index) => {
        const problems = validateToolInputExample(schema, example as Record<string, unknown>);
        assert(problems.length === 0,
          `case1: "${toolName}" example[${index}] validates against the LIVE schema`,
          problems.join('; '));
      });
    }
    assert(Object.keys(TOOL_INPUT_EXAMPLES).length >= 10,
      'case1: at least 10 gnarly tools carry curated examples');
  }

  // ─── Case 2: chokepoint integration — catalog defs carry examples ───────
  {
    const defs = listOpenSwanAnthropicToolsForSurface('main_chat');
    const decorated = defs.filter((d) => Array.isArray((d as any).input_examples) && (d as any).input_examples.length > 0);
    assert(decorated.length >= 8,
      'case2: main_chat catalog carries input_examples on the curated tools',
      `got ${decorated.length}`);
    const psTransform = defs.find((d) => d.name === 'desktop.photoshop_transform_layer') as any;
    assert(psTransform && Array.isArray(psTransform.input_examples)
      && psTransform.input_examples[0].layerName === 'Price Tag',
      'case2: photoshop_transform_layer carries its curated example verbatim');
    const undecorated = defs.find((d) => d.name === 'tasks.list') as any;
    assert(undecorated ? undecorated.input_examples === undefined : true,
      'case2: tools without curated examples carry NO input_examples field');
  }

  // ─── Case 3: validator failure classes ──────────────────────────────────
  {
    const schema = {
      type: 'object',
      properties: {
        op: { type: 'string', enum: ['move', 'scale'] },
        layerName: { type: 'string' },
        deltaX: { type: 'number' },
        tags: { type: 'array', minItems: 1, maxItems: 2, items: { type: 'string' } },
        pairs: {
          type: 'array',
          items: {
            type: 'object',
            properties: { findText: { type: 'string' }, changeText: { type: 'string' } },
            required: ['findText', 'changeText'],
          },
        },
      },
      required: ['op', 'layerName'],
    };
    assert(validateToolInputExample(schema, { op: 'move', layerName: 'Logo', deltaX: 10 }).length === 0,
      'case3: conforming example passes');
    assert(validateToolInputExample(schema, { op: 'move' }).some((p) => p.includes('layerName')),
      'case3: missing required key caught');
    assert(validateToolInputExample(schema, { op: 'move', layerName: 'x', bogus: 1 }).some((p) => p.includes('unknown key')),
      'case3: unknown key caught');
    assert(validateToolInputExample(schema, { op: 'rotate', layerName: 'x' }).some((p) => p.includes('enum')),
      'case3: enum violation caught');
    assert(validateToolInputExample(schema, { op: 'move', layerName: 'x', deltaX: 'ten' }).some((p) => p.includes('expected type')),
      'case3: primitive type mismatch caught');
    assert(validateToolInputExample(schema, { op: 'move', layerName: 'x', tags: [] }).some((p) => p.includes('minItems')),
      'case3: array minItems caught');
    assert(validateToolInputExample(schema, { op: 'move', layerName: 'x', tags: ['a', 'b', 'c'] }).some((p) => p.includes('maxItems')),
      'case3: array maxItems caught');
    assert(validateToolInputExample(schema, { op: 'move', layerName: 'x', pairs: [{ findText: 'a' }] })
      .some((p) => p.includes('missing required "changeText"')),
      'case3: nested array item missing required caught');
    assert(validateToolInputExample(schema, { op: 'move', layerName: 'x', pairs: [{ findText: 'a', changeText: 'b', junk: 1 }] })
      .some((p) => p.includes('unknown key "junk"')),
      'case3: nested array item unknown key caught');
    assert(validateToolInputExample(schema, null as any).length > 0, 'case3: null example rejected');
    assert(validateToolInputExample({ properties: { body: { description: 'free-form' } } }, { body: { anything: true } }).length === 0,
      'case3: untyped property accepts any value (compose_action body)');
  }

  // ─── Case 3b: recursive nested-OBJECT validation (the 400 blind spot) ────
  // A nested object violating its sub-schema used to pass with zero problems
  // — which would sail through smoke + the attach guard and then 400 every
  // live request carrying the example. These cases pin the recursion.
  {
    const schema = {
      type: 'object',
      properties: {
        goal: { type: 'string' },
        target: {
          type: 'object',
          properties: {
            kind: { type: 'string', enum: ['layer', 'frame'] },
            name: { type: 'string' },
            geometry: {
              type: 'object',
              properties: { x: { type: 'number' }, y: { type: 'number' } },
              required: ['x', 'y'],
            },
          },
          required: ['kind', 'name'],
        },
        body: { type: 'object' }, // type object but NO properties → free-form
      },
      required: ['goal'],
    };

    // (a) nested object missing a required sub-key
    const missingSub = validateToolInputExample(schema, { goal: 'g', target: { kind: 'layer' } });
    assert(missingSub.some((p) => p.includes('target') && p.includes('missing required "name"')),
      'case3b: nested object missing required sub-key caught', missingSub.join('; '));

    // (b) nested unknown key where sub-properties ARE declared
    const unknownSub = validateToolInputExample(schema, { goal: 'g', target: { kind: 'layer', name: 'Hero', bogus: 1 } });
    assert(unknownSub.some((p) => p.includes('target') && p.includes('unknown key "bogus"')),
      'case3b: nested object unknown key caught (sub-properties declared)', unknownSub.join('; '));

    // nested enum + nested primitive type mismatch
    assert(validateToolInputExample(schema, { goal: 'g', target: { kind: 'path', name: 'x' } })
      .some((p) => p.includes('kind') && p.includes('enum')),
      'case3b: nested enum violation caught');
    assert(validateToolInputExample(schema, { goal: 'g', target: { kind: 'layer', name: 42 } })
      .some((p) => p.includes('name') && p.includes('expected type string')),
      'case3b: nested primitive type mismatch caught');

    // (c) free-form object property (type:'object', NO declared sub-properties)
    // with arbitrary keys must still pass — compose_action's `body` shape.
    assert(validateToolInputExample(schema, { goal: 'g', body: { anything: true, nested: { deep: [1, 'two'] } } }).length === 0,
      'case3b: free-form object property (no declared sub-properties) passes');

    // (d) doubly-nested violation (target.geometry missing required "y")
    const deepViolation = validateToolInputExample(schema, {
      goal: 'g',
      target: { kind: 'layer', name: 'Hero', geometry: { x: 1 } },
    });
    assert(deepViolation.some((p) => p.includes('geometry') && p.includes('missing required "y"')),
      'case3b: doubly-nested required violation caught', deepViolation.join('; '));

    // fully conforming nested example passes
    assert(validateToolInputExample(schema, {
      goal: 'g',
      target: { kind: 'frame', name: 'Hero', geometry: { x: 1, y: 2 } },
    }).length === 0, 'case3b: conforming nested example passes');

    // depth bound: scalar checks reach depth 4; children OF a depth-4
    // container are past the documented bound and pass unvalidated.
    assert((MAX_NESTED_VALIDATION_DEPTH as number) === 4,
      'case3b: depth bound is 4 (update the depth-bound cases below if changed)');
    const deepSchema = {
      type: 'object',
      properties: {
        a: { type: 'object', properties: {                       // a  = depth 1
          b: { type: 'object', properties: {                     // b  = depth 2
            c: { type: 'object', properties: {                   // c  = depth 3
              d: { type: 'object', properties: { e: { type: 'string' } }, required: ['e'] }, // d = depth 4
            } },
          } },
        } },
      },
    };
    assert(validateToolInputExample(deepSchema, { a: { b: { c: { d: 5 } } } })
      .some((p) => p.includes('expected type object')),
      'case3b: violation AT depth 4 still caught (scalar check)');
    assert(validateToolInputExample(deepSchema, { a: { b: { c: { d: {} } } } }).length === 0,
      'case3b: violation BELOW depth 4 (missing required inside depth-4 container) passes — documented bound');

    // cyclic schema + cyclic value terminate at the depth bound (never throws/hangs)
    const cycSchema: any = { type: 'object', properties: {} };
    cycSchema.properties.self = cycSchema;
    const cycValue: any = {};
    cycValue.self = cycValue;
    assert(Array.isArray(validateToolInputExample(cycSchema, cycValue)),
      'case3b: cyclic schema+value terminate at the depth bound');
  }

  // ─── Case 4: attach helper — fail-safe drop + non-mutation + passthrough ─
  {
    const goodDef = {
      name: 'desktop.photoshop_transform_layer',
      description: 'd',
      input_schema: {
        type: 'object',
        properties: {
          appName: { type: 'string' }, targetDocumentName: { type: 'string' },
          layerName: { type: 'string' },
          op: { type: 'string', enum: ['move', 'scale', 'rotate'] },
          deltaX: { type: 'number' }, deltaY: { type: 'number' },
          scalePercent: { type: 'number' }, rotateDegrees: { type: 'number' },
        },
        required: ['layerName', 'op'],
      },
    };
    // A schema that DRIFTED (op enum no longer includes 'move'/'scale').
    const driftedDef = {
      name: 'desktop.photoshop_transform_layer',
      description: 'd',
      input_schema: {
        type: 'object',
        properties: { layerName: { type: 'string' }, op: { type: 'string', enum: ['warp'] } },
        required: ['layerName', 'op'],
      },
    };
    const plainDef = { name: 'tasks.list', description: 'd', input_schema: { type: 'object', properties: {} } };

    const attached = attachToolInputExamples([goodDef, driftedDef, plainDef]);
    assert(Array.isArray(attached[0].input_examples) && attached[0].input_examples!.length === 2,
      'case4: valid examples attach to the conforming schema');
    assert(attached[1].input_examples === undefined,
      'case4: DRIFTED schema → all examples dropped, none sent (fail-safe against API 400)');
    assert(attached[2].input_examples === undefined,
      'case4: tool without curated examples passes through unchanged');
    assert(!('input_examples' in goodDef), 'case4: input defs never mutated');
    assert(getToolInputExamples('desktop.cad_compile')!.length === 2, 'case4: getter returns curated set');
    assert(getToolInputExamples('nonexistent.tool') === null, 'case4: getter null for unknown tool');
  }

  // ─── Case 5: no secret VALUES in any example ────────────────────────────
  // Keys may legitimately reference credential STORES (`onePasswordItem` is
  // a 1Password item NAME, not a secret) — the invariant is on values.
  {
    const stringValues: string[] = [];
    const collect = (value: unknown): void => {
      if (typeof value === 'string') stringValues.push(value.toLowerCase());
      else if (Array.isArray(value)) value.forEach(collect);
      else if (value && typeof value === 'object') Object.values(value).forEach(collect);
    };
    collect(TOOL_INPUT_EXAMPLES);
    for (const marker of ['password', 'api_key', 'apikey', 'sk-', 'ghp_', 'bearer ', 'secret']) {
      assert(!stringValues.some((v) => v.includes(marker)),
        `case5: no "${marker}" in any curated example VALUE`);
    }
  }

  console.log(failures === 0 ? '\ntool-input-examples smoke: ALL GREEN' : `\n${failures} FAILURES`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('FATAL:', err);
  process.exit(1);
});
