/**
 * engineering-design-card-core smoke.
 *
 * The card core turns a bounded engineering capture into the render model the
 * chat Engineering Design Card draws. This smoke runs the REAL pipeline —
 * designPart output → runtime result shape → capture core → card core — and
 * asserts the view model: '<Type> — <mass> <material>' title, humanized
 * dimension rows (sectionModulus_mm3 → 'Section modulus' + mm³), safety pill
 * tones for meets/BELOW/over-stress cases, mass/fit chips, bounded notes, and
 * next-step chips whose seedCommand text chains desktop.cad_compile /
 * engineering.inspect_mesh. Totality: garbage in → null out, never a throw.
 */

import { designPart } from '../src/lib/engineeringDesignCore';
import { springRate } from '../src/lib/engineeringCalcCore';
import {
  ENGINEERING_TOOL_CAPTURE_KEY,
  buildEngineeringToolCaptureMetadata,
  type EngineeringDesignCapture,
  type EngineeringToolCapture,
} from '../src/lib/engineeringRuntimeCaptureCore';
import {
  buildEngineeringCardModel,
  buildEngineeringCardModels,
  formatMass,
  humanizeDimensionKey,
  type EngineeringCalcCardModel,
  type EngineeringDesignCardModel,
} from '../src/lib/engineeringDesignCardCore';

let passed = 0;
const failures: string[] = [];
function assert(cond: boolean, label: string) {
  if (cond) { passed++; console.log(`pass: ${label}`); }
  else { failures.push(label); console.error(`FAIL: ${label}`); }
}

function captureFor(input: Record<string, unknown>): EngineeringToolCapture {
  const res = designPart({ ...input, outputPath: input.outputPath ?? '/tmp/uc-design.stl' });
  if (!res.ok) throw new Error(`designPart failed: ${res.error}`);
  const p = res.value;
  const runtimeResult = {
    ok: true,
    script: p.bpy,
    design: { type: p.type, dimensions: p.dimensions, safety: p.safety, mass_kg: p.mass_kg, fit: p.fit ?? null },
    resultsText: `Designed ${p.summary}. Dimensions: x.`,
  };
  const fragment = buildEngineeringToolCaptureMetadata('engineering.design_part', runtimeResult, input);
  if (!fragment) throw new Error('capture failed');
  return fragment[ENGINEERING_TOOL_CAPTURE_KEY];
}

function main() {
  // ─── Key humanization ──────────────────────────────────────────────────────
  {
    assert(humanizeDimensionKey('sectionModulus_mm3').label === 'Section modulus', 'sectionModulus_mm3 → "Section modulus"');
    assert(humanizeDimensionKey('sectionModulus_mm3').unit === 'mm³', 'sectionModulus_mm3 unit mm³');
    assert(humanizeDimensionKey('pitchDiameterPinion_mm').label === 'Pitch diameter pinion', 'pitchDiameterPinion_mm humanized');
    assert(humanizeDimensionKey('pitchDiameterPinion_mm').unit === 'mm', 'pitchDiameterPinion_mm unit mm');
    assert(humanizeDimensionKey('width').label === 'Width' && humanizeDimensionKey('width').unit === undefined, 'plain key gets no unit guess');
    assert(humanizeDimensionKey('bendingMoment_Nmm').unit === 'N·mm', 'Nmm suffix → N·mm');
    assert(humanizeDimensionKey('outputSpeed_rpm').unit === 'rpm', 'rpm suffix preserved');
    assert(humanizeDimensionKey('minClearance_um').unit === 'µm', 'um suffix → µm');
    assert(humanizeDimensionKey('boreDiameter').label === 'Bore diameter', 'camelCase splits');
    assert(humanizeDimensionKey('').label === '', 'empty key is safe');
  }

  // ─── Mass formatting ───────────────────────────────────────────────────────
  {
    assert(formatMass(0.577) === '577 g', '0.577 kg → "577 g"');
    assert(formatMass(5.437) === '5.44 kg', '5.437 kg → "5.44 kg"');
    assert(formatMass(1) === '1 kg', '1 kg boundary → kg form');
    assert(formatMass(-1) === null, 'negative mass → null');
    assert(formatMass(NaN as number) === null, 'NaN mass → null');
  }

  // ─── Real bracket capture → design card ───────────────────────────────────
  {
    const capture = captureFor({ type: 'bracket', load: 500, arm: 100, material: 'steel', safetyFactor: 2, width: 40, boreDiameter: 20 });
    const model = buildEngineeringCardModel(capture) as EngineeringDesignCardModel;
    assert(!!model && model.kind === 'design', 'bracket card built');
    assert(/^Bracket — \d+ g steel$/.test(model.title), `title is "Bracket — <g> steel" style (got "${model.title}")`);
    assert(model.dimensionRows.some((r) => r.label === 'Section modulus' && r.unit === 'mm³'), 'dimension row humanized: Section modulus (mm³)');
    assert(model.dimensionRows.some((r) => r.label === 'Thickness' && r.value === '8'), 'thickness row present');
    assert(model.safetyPill?.tone === 'ok', 'safety pill ok for a met target');
    assert(!!model.safetyPill && /Safety [\d.]+×/.test(model.safetyPill.label), 'safety pill label carries the factor');
    assert(model.massChip !== null && /g$/.test(model.massChip), 'mass chip in grams');
    assert(model.fitChip !== null && model.fitChip.includes('H7/g6'), 'fit chip carries H7/g6');
    assert(model.materialChip === 'steel', 'material chip');
    assert(model.nextSteps.length >= 2, 'at least two next steps');
    assert(model.nextSteps[0].label === 'Compile to STL', 'first next step is Compile to STL');
    assert(model.nextSteps[0].seedCommand.includes('desktop.cad_compile') && model.nextSteps[0].seedCommand.includes('blender'), 'compile seed chains desktop.cad_compile blender');
    assert(model.nextSteps[0].seedCommand.includes('/tmp/uc-design.stl'), 'compile seed carries the output path');
    assert(model.nextSteps[1].label === 'Verify mesh' && model.nextSteps[1].seedCommand.includes('engineering.inspect_mesh'), 'verify seed chains engineering.inspect_mesh');
    assert(model.nextSteps.some((s) => s.id === 'check_fit'), 'fit present → Check fit chip added');
    assert(model.truncated === false, 'bracket card not truncated');
  }

  // ─── Notes-heavy gearbox capture → card still bounded ─────────────────────
  {
    const capture = captureFor({ type: 'gearbox', power_kW: 5, inputSpeed_rpm: 1500, ratio: 3 });
    const model = buildEngineeringCardModel(capture) as EngineeringDesignCardModel;
    assert(!!model && model.kind === 'design', 'gearbox card built');
    assert(model.title.startsWith('Gearbox — '), 'gearbox title prefixed');
    assert(model.dimensionRows.length <= 24, 'dimension rows bounded');
    assert(model.notes.length <= 6, 'notes bounded to ≤ 6');
    assert(model.dimensionRows.some((r) => r.label === 'Center distance' && r.unit === 'mm'), 'centerDistance_mm humanized');
  }

  // ─── Safety pill tones ─────────────────────────────────────────────────────
  {
    const below: EngineeringDesignCapture = {
      kind: 'design', tool: 'engineering.design_part', type: 'bracket',
      dimensions: { width: 40 },
      safety: { allowableStress_MPa: 125, realisedStress_MPa: 150, realisedSafetyFactor: 1.6, note: 'BELOW the 2× target' },
      mass_kg: 0.3,
    };
    const model = buildEngineeringCardModel(below) as EngineeringDesignCardModel;
    assert(model.safetyPill?.tone === 'danger', 'note "BELOW …" → danger tone');

    const overStress: EngineeringDesignCapture = {
      ...below,
      safety: { allowableStress_MPa: 100, realisedStress_MPa: 140, note: 'check' },
    };
    assert((buildEngineeringCardModel(overStress) as EngineeringDesignCardModel).safetyPill?.tone === 'danger', 'realised > allowable → danger tone');

    const subUnity: EngineeringDesignCapture = {
      ...below,
      safety: { realisedSafetyFactor: 0.9, note: 'tight' },
    };
    assert((buildEngineeringCardModel(subUnity) as EngineeringDesignCardModel).safetyPill?.tone === 'danger', 'factor < 1 → danger tone');

    const slim: EngineeringDesignCapture = {
      ...below,
      safety: { realisedSafetyFactor: 1.1, note: 'slim margin' },
    };
    assert((buildEngineeringCardModel(slim) as EngineeringDesignCardModel).safetyPill?.tone === 'warn', 'factor 1.1 → warn tone');

    const meets: EngineeringDesignCapture = {
      ...below,
      safety: { allowableStress_MPa: 125, realisedStress_MPa: 117, realisedSafetyFactor: 2.13, note: 'meets the 2× target' },
    };
    assert((buildEngineeringCardModel(meets) as EngineeringDesignCardModel).safetyPill?.tone === 'ok', '"meets" + healthy factor → ok tone');

    const noSafety: EngineeringDesignCapture = { kind: 'design', tool: 'engineering.design_part', type: 'shaft', dimensions: { diameter: 20 } };
    assert((buildEngineeringCardModel(noSafety) as EngineeringDesignCardModel).safetyPill === null, 'no safety block → no pill');
  }

  // ─── Real calc capture → calc strip ───────────────────────────────────────
  {
    const r = springRate({ wireDiameter: 4, meanDiameter: 32, activeCoils: 8, material: 'steel' });
    if (r.ok) {
      const fragment = buildEngineeringToolCaptureMetadata('engineering.calc', { ok: true, result: r, resultsText: 'x' }, { kind: 'spring_rate' })!;
      const model = buildEngineeringCardModel(fragment[ENGINEERING_TOOL_CAPTURE_KEY]) as EngineeringCalcCardModel;
      assert(!!model && model.kind === 'calc', 'calc strip built');
      assert(model.title === r.quantity, 'calc title = quantity');
      assert(model.answer.endsWith(` ${r.unit}`) && Math.abs(parseFloat(model.answer) - r.value) <= 0.01, `answer carries value + unit (got "${model.answer}" for ${r.value} ${r.unit})`);
      assert(model.formula === r.formula, 'formula carried');
      assert(model.inputRows.length > 0, 'input rows present');
      assert(model.truncated === false, 'calc strip not truncated');
    } else {
      assert(false, 'sanity: springRate calc succeeds');
    }
  }

  // ─── Totality: malformed captures → null, never a throw ───────────────────
  {
    const garbage: Array<[string, unknown]> = [
      ['null', null],
      ['undefined', undefined],
      ['empty object', {}],
      ['number', 7],
      ['string', 'hello'],
      ['array', [1, 2]],
      ['unknown kind', { kind: 'mystery' }],
      ['design without type', { kind: 'design', dimensions: {} }],
      ['design without dimensions', { kind: 'design', type: 'bracket' }],
      ['design dimensions wrong type', { kind: 'design', type: 'bracket', dimensions: 'nope' }],
      ['calc without value', { kind: 'calc', quantity: 'q', unit: 'u' }],
      ['calc NaN value', { kind: 'calc', quantity: 'q', unit: 'u', value: NaN }],
      ['huge string type', { kind: 'design', type: 'z'.repeat(100_000), dimensions: null }],
    ];
    for (const [label, capture] of garbage) {
      let threw = false; let model: unknown = 'unset';
      try { model = buildEngineeringCardModel(capture); } catch { threw = true; }
      assert(!threw && model === null, `garbage capture → null without throwing: ${label}`);
    }
    // Adversarial getters cannot crash the builder either.
    const trap = { kind: 'design', type: 'bracket', get dimensions(): Record<string, number> { throw new Error('boom'); } };
    let threw = false; let model: unknown = 'unset';
    try { model = buildEngineeringCardModel(trap); } catch { threw = true; }
    assert(!threw && model === null, 'throwing getter → null without throwing');
  }

  // ─── List mapper ───────────────────────────────────────────────────────────
  {
    const good = captureFor({ type: 'shaft', torque: 100 });
    const models = buildEngineeringCardModels([good, { kind: 'design' } as any, good]);
    assert(models.length === 2, 'list mapper skips the malformed capture');
    assert(buildEngineeringCardModels(null).length === 0, 'null list → empty');
    assert(buildEngineeringCardModels(undefined).length === 0, 'undefined list → empty');
  }

  console.log(`\n${passed} assertions passed, ${failures.length} failed`);
  if (failures.length > 0) process.exit(1);
}

main();
