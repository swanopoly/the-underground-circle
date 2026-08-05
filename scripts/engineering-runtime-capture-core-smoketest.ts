/**
 * engineering-runtime-capture-core smoke.
 *
 * The capture core turns the REAL engineering.design_part / engineering.calc
 * runtime results into a bounded transient-metadata fragment for the chat
 * card. This smoke feeds actual designPart outputs (bracket, gearbox — the
 * notes-heaviest recipe) through the exact runtime result shape from
 * openswanToolRuntime and asserts:
 *   1. the capture carries the design fields (type/dimensions/safety/mass/fit),
 *   2. the serialized capture NEVER exceeds the 2 500-byte budget,
 *   3. the bpy/script body NEVER leaks into the capture ('import bpy',
 *      'stl_export' absent),
 *   4. totality — null/{} / huge-string garbage returns null, never throws,
 *   5. calc results round-trip with kind/quantity/value/unit/formula/inputs,
 *   6. extraction from tool events is bounded (≤ 4) and skips junk.
 */

import { designPart } from '../src/lib/engineeringDesignCore';
import { springRate } from '../src/lib/engineeringCalcCore';
import {
  ENGINEERING_CAPTURE_MAX_BYTES,
  ENGINEERING_TOOL_CAPTURE_KEY,
  buildEngineeringToolCaptureMetadata,
  extractEngineeringCapturesFromToolEvents,
  parseEngineeringToolCapture,
  type EngineeringCalcCapture,
  type EngineeringDesignCapture,
} from '../src/lib/engineeringRuntimeCaptureCore';

let passed = 0;
const failures: string[] = [];
function assert(cond: boolean, label: string) {
  if (cond) { passed++; console.log(`pass: ${label}`); }
  else { failures.push(label); console.error(`FAIL: ${label}`); }
}

/** Build the exact runtime result shape from openswanToolRuntime's design_part case. */
function runtimeDesignResult(input: Record<string, unknown>) {
  const res = designPart({ ...input, outputPath: input.outputPath ?? '/tmp/uc-design.stl' });
  if (!res.ok) throw new Error(`designPart failed: ${res.error}`);
  const p = res.value;
  const dims = Object.entries(p.dimensions).map(([k, v]) => `${k}=${v}`).join(', ');
  const fitStr = p.fit ? ` | fit ${p.fit.spec} ${p.fit.type} ${p.fit.minClearance_um}–${p.fit.maxClearance_um} µm` : '';
  return {
    part: p,
    result: {
      ok: true,
      script: p.bpy,
      design: { type: p.type, dimensions: p.dimensions, safety: p.safety, mass_kg: p.mass_kg, fit: p.fit ?? null },
      resultsText: `Designed ${p.summary}. Dimensions: ${dims}. Safety: σ ${p.safety.realisedStress_MPa} MPa vs ${p.safety.allowableStress_MPa} allowable → factor ${p.safety.realisedSafetyFactor} (${p.safety.note})${fitStr}. Mass ${p.mass_kg} kg.\n${p.notes.join('\n')}`,
    } as Record<string, unknown>,
  };
}

function bytes(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).length;
}

function main() {
  // ─── 1. Real bracket design capture ────────────────────────────────────────
  {
    const input = { type: 'bracket', load: 500, arm: 100, material: 'steel', safetyFactor: 2, width: 40, boreDiameter: 20, outputPath: '/tmp/uc-bracket.stl' };
    const { part, result } = runtimeDesignResult(input);
    assert(part.bpy.includes('import bpy') || part.bpy.includes('stl_export'), 'sanity: the real bpy body carries the script markers we must strip');

    const fragment = buildEngineeringToolCaptureMetadata('engineering.design_part', result, input);
    assert(!!fragment, 'bracket capture built');
    const capture = fragment![ENGINEERING_TOOL_CAPTURE_KEY] as EngineeringDesignCapture;
    assert(capture.kind === 'design' && capture.tool === 'engineering.design_part', 'design capture kind/tool');
    assert(capture.type === 'bracket', 'type captured');
    assert(capture.dimensions.width === 40 && capture.dimensions.thickness === 8, 'sized dimensions captured (width 40, thickness 8)');
    assert(capture.dimensions.sectionModulus_mm3 === part.dimensions.sectionModulus_mm3, 'section modulus captured');
    assert(capture.safety?.realisedSafetyFactor === part.safety.realisedSafetyFactor, 'realised safety factor captured');
    assert(typeof capture.safety?.note === 'string' && capture.safety.note.includes('meets'), 'safety note captured ("meets the 2× target")');
    assert(capture.mass_kg === part.mass_kg, 'mass captured');
    assert(capture.fit?.spec === 'H7/g6' && capture.fit.type === 'clearance', 'fit captured (H7/g6 clearance)');
    assert(capture.fit?.minClearance_um === 7, 'fit clearance band captured');
    assert(capture.material === 'steel', 'material captured (from input)');
    assert(capture.outputPath === '/tmp/uc-bracket.stl', 'outputPath captured');
    assert(typeof capture.summary === 'string' && capture.summary.includes('bracket'), 'summary recovered from resultsText first sentence');

    const json = JSON.stringify(fragment);
    assert(bytes(fragment) <= ENGINEERING_CAPTURE_MAX_BYTES, `bracket capture ≤ ${ENGINEERING_CAPTURE_MAX_BYTES} bytes (got ${bytes(fragment)})`);
    assert(!json.includes('import bpy'), 'capture never contains "import bpy"');
    assert(!json.includes('stl_export'), 'capture never contains "stl_export"');
    assert(!json.includes('resultsText'), 'capture never embeds the raw resultsText field');
  }

  // ─── 2. Gearbox (notes-heavy, 27 dimension keys) stays in budget ──────────
  {
    const input = { type: 'gearbox', power_kW: 5, inputSpeed_rpm: 1500, ratio: 3, material: 'steel', outputPath: '/tmp/uc-gearbox.stl' };
    const { part, result } = runtimeDesignResult(input);
    assert(part.notes.length >= 8, `sanity: gearbox is notes-heavy (${part.notes.length} notes)`);
    assert(Object.keys(part.dimensions).length >= 20, `sanity: gearbox has a large dimension set (${Object.keys(part.dimensions).length})`);

    const fragment = buildEngineeringToolCaptureMetadata('engineering.design_part', result, input);
    assert(!!fragment, 'gearbox capture built');
    const capture = fragment![ENGINEERING_TOOL_CAPTURE_KEY] as EngineeringDesignCapture;
    assert(capture.type === 'gearbox', 'gearbox type captured');
    assert(capture.dimensions.shaftDiameter_mm === part.dimensions.shaftDiameter_mm, 'gearbox shaft diameter captured');
    const size = bytes(fragment);
    assert(size <= ENGINEERING_CAPTURE_MAX_BYTES, `gearbox capture ≤ ${ENGINEERING_CAPTURE_MAX_BYTES} bytes (got ${size})`);
    const json = JSON.stringify(fragment);
    assert(!json.includes('import bpy') && !json.includes('stl_export'), 'gearbox capture never contains script bodies');
  }

  // ─── 3. Notes clamp: oversized synthetic notes are trimmed + flagged ──────
  {
    const input = { type: 'bracket', load: 500, arm: 100 };
    const { result } = runtimeDesignResult(input);
    const design = result.design as Record<string, unknown>;
    design.notes = Array.from({ length: 30 }, (_, i) => `note ${i} ${'x'.repeat(400)}`);
    const fragment = buildEngineeringToolCaptureMetadata('engineering.design_part', result, input);
    assert(!!fragment, 'notes-flooded capture still builds');
    const capture = fragment![ENGINEERING_TOOL_CAPTURE_KEY] as EngineeringDesignCapture;
    assert(capture.truncated === true, 'flooded notes set truncated: true');
    assert((capture.notes ?? []).length <= 6, 'notes clamped to ≤ 6 items');
    assert((capture.notes ?? []).every((n) => n.length <= 220), 'each note clamped to ≤ 220 chars');
    assert(bytes(fragment) <= ENGINEERING_CAPTURE_MAX_BYTES, 'flooded capture still ≤ budget');
  }

  // ─── 4. Adversarial huge payload: budget always wins ──────────────────────
  {
    const dims: Record<string, number> = {};
    for (let i = 0; i < 500; i++) dims[`aVeryLongDimensionKeyNumber_${i}_mm`] = i * 1.234567;
    const result = {
      ok: true,
      design: {
        type: 'bracket',
        dimensions: dims,
        safety: { note: 'meets the 2× target' },
        mass_kg: 1,
      },
      resultsText: `Designed monster. Dimensions: none.`,
    };
    const fragment = buildEngineeringToolCaptureMetadata('engineering.design_part', result, {});
    assert(!!fragment, 'monster-dimensions capture still builds');
    const capture = fragment![ENGINEERING_TOOL_CAPTURE_KEY] as EngineeringDesignCapture;
    assert(capture.truncated === true, 'monster dimensions flagged truncated');
    assert(bytes(fragment) <= ENGINEERING_CAPTURE_MAX_BYTES, `monster capture clamped to budget (got ${bytes(fragment)})`);
    assert(Object.keys(capture.dimensions).length <= 32, 'dimension keys clamped');
  }

  // ─── 5. Calc capture round-trip with a REAL calc result ───────────────────
  {
    const r = springRate({ wireDiameter: 4, meanDiameter: 32, activeCoils: 8, material: 'steel' });
    assert(r.ok === true, 'sanity: springRate calc succeeds');
    if (r.ok) {
      const runtimeResult = {
        ok: true,
        result: r,
        resultsText: `${r.quantity} = ${r.value} ${r.unit}  [${r.formula}]`,
      };
      const fragment = buildEngineeringToolCaptureMetadata('engineering.calc', runtimeResult, { kind: 'spring_rate', args: {} });
      assert(!!fragment, 'calc capture built');
      const capture = fragment![ENGINEERING_TOOL_CAPTURE_KEY] as EngineeringCalcCapture;
      assert(capture.kind === 'calc' && capture.tool === 'engineering.calc', 'calc capture kind/tool');
      assert(capture.calcKind === 'spring_rate', 'calc kind echoed from input');
      assert(capture.quantity === r.quantity, 'quantity captured');
      assert(capture.value === r.value, 'value captured exactly');
      assert(capture.unit === r.unit, 'unit captured');
      assert(capture.formula === r.formula, 'formula captured');
      assert(!!capture.inputs && Object.keys(capture.inputs).length > 0, 'inputs echo captured');
      assert(bytes(fragment) <= ENGINEERING_CAPTURE_MAX_BYTES, 'calc capture within budget');
      // Round-trip through the parser used by extraction.
      const parsed = parseEngineeringToolCapture(capture);
      assert(!!parsed && parsed.kind === 'calc' && (parsed as EngineeringCalcCapture).value === r.value, 'calc capture parses back');
    }
  }

  // ─── 6. Totality: malformed inputs return null, never throw ───────────────
  {
    const malformed: Array<[string, unknown, unknown]> = [
      ['null result', null, {}],
      ['undefined result', undefined, {}],
      ['empty object', {}, {}],
      ['ok:false result', { ok: false, resultsText: 'err' }, {}],
      ['design missing', { ok: true, resultsText: 'x' }, {}],
      ['design not a record', { ok: true, design: 'nope' }, {}],
      ['design without type', { ok: true, design: { dimensions: { a: 1 } } }, {}],
      ['calc missing result', { ok: true, resultsText: 'x' }, { kind: 'x' }],
      ['calc result not ok', { ok: true, result: { ok: false, error: 'e' } }, {}],
      ['calc result missing value', { ok: true, result: { ok: true, quantity: 'q', unit: 'u' } }, {}],
      ['huge string result', { ok: true, design: 'y'.repeat(100_000) }, {}],
      ['array result', [1, 2, 3], {}],
      ['number result', 42, {}],
    ];
    for (const [label, result, input] of malformed) {
      let value: unknown = 'unset';
      let threw = false;
      try {
        value = buildEngineeringToolCaptureMetadata('engineering.design_part', result, input)
          ?? buildEngineeringToolCaptureMetadata('engineering.calc', result, input);
      } catch { threw = true; }
      assert(!threw && (value === null || value === undefined), `malformed → null without throwing: ${label}`);
    }
    // Wrong tool name never captures even a valid result.
    const { result } = runtimeDesignResult({ type: 'shaft', torque: 100 });
    assert(buildEngineeringToolCaptureMetadata('engineering.model_3d', result, {}) === null, 'non-engineering-card tool returns null');
    assert(buildEngineeringToolCaptureMetadata('browser.fill_field', result, {}) === null, 'unrelated tool returns null');
  }

  // ─── 7. Extraction from tool events: bounded, junk-safe ───────────────────
  {
    const input = { type: 'shaft', torque: 250, outputPath: '/tmp/uc-shaft.stl' };
    const { result } = runtimeDesignResult(input);
    const fragment = buildEngineeringToolCaptureMetadata('engineering.design_part', result, input)!;
    const goodEvent = { tool: 'engineering.design_part', metadata: fragment as Record<string, unknown> };
    const junkEvents = [
      { tool: 'browser.fill_field', metadata: { toolPolicy: {} } },
      { tool: 'engineering.calc' }, // no metadata
      { metadata: { [ENGINEERING_TOOL_CAPTURE_KEY]: { kind: 'design' } } }, // missing type/dimensions
      { metadata: { [ENGINEERING_TOOL_CAPTURE_KEY]: 'not-a-record' } },
      { metadata: null },
    ];
    const extracted = extractEngineeringCapturesFromToolEvents([...junkEvents, goodEvent] as any);
    assert(extracted.length === 1, 'junk events skipped, one real capture extracted');
    assert(extracted[0].kind === 'design' && (extracted[0] as EngineeringDesignCapture).type === 'shaft', 'extracted capture is the shaft design');

    const many = extractEngineeringCapturesFromToolEvents(Array.from({ length: 10 }, () => goodEvent) as any);
    assert(many.length === 4, 'extraction capped at 4 captures');
    assert(extractEngineeringCapturesFromToolEvents(null).length === 0, 'null events → empty list');
    assert(extractEngineeringCapturesFromToolEvents(undefined).length === 0, 'undefined events → empty list');
    assert(extractEngineeringCapturesFromToolEvents('nope' as any).length === 0, 'non-array events → empty list');
  }

  console.log(`\n${passed} assertions passed, ${failures.length} failed`);
  if (failures.length > 0) process.exit(1);
}

main();
