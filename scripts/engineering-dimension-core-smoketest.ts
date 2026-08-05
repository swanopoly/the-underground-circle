/**
 * engineering-dimension-core smoke.
 *
 * The one property that MUST hold — and the reason this core exists — is that a
 * dimension's text equals the distance it actually spans. A drawing that labels
 * a 90 mm feature "100" tells a machinist to cut the wrong part. Every case
 * below feeds explicit points and asserts the emitted text equals the value
 * derived from those points, for horizontal, vertical, and aligned dimensions.
 */

import {
  formatDim, linearDimension, diameterDimension, radiusDimension, titleBlock,
  DIMS_LAYER,
} from '../src/lib/engineeringDimensionCore';

let passed = 0;
const failures: string[] = [];
function assert(cond: boolean, label: string) {
  if (cond) { passed++; console.log(`pass: ${label}`); }
  else { failures.push(label); console.error(`FAIL: ${label}`); }
}

function main() {
  // ─── formatDim ───────────────────────────────────────────────────
  {
    assert(formatDim(100) === '100', '100 → "100"');
    assert(formatDim(49.996) === '50', '49.996 → "50" (rounds to 2dp)');
    assert(formatDim(50.5) === '50.5', '50.5 → "50.5"');
    assert(formatDim(50.25) === '50.25', '50.25 → "50.25"');
    assert(formatDim(0) === '0', '0 → "0"');
  }

  // ─── THE property: text == measured distance ─────────────────────
  {
    // Horizontal: |Δx| regardless of Δy.
    const h = linearDimension(0, 0, 100, 30, { orientation: 'horizontal' });
    assert(h.value === 100 && h.text === '100', 'horizontal dim (0,0)-(100,30) measures Δx = 100');

    // Vertical: |Δy| regardless of Δx.
    const v = linearDimension(0, 0, 20, 50, { orientation: 'vertical' });
    assert(v.value === 50 && v.text === '50', 'vertical dim (0,0)-(20,50) measures Δy = 50');

    // Aligned: true distance. (30,40) → 50 (3-4-5).
    const a = linearDimension(0, 0, 30, 40, { orientation: 'aligned' });
    assert(a.value === 50 && a.text === '50', 'aligned dim (0,0)-(30,40) measures 50');

    // A non-round distance rounds honestly, not truncated.
    const nr = linearDimension(0, 0, 33.335, 0, { orientation: 'horizontal' });
    assert(nr.text === '33.34' || nr.text === '33.33', `non-round distance rounds to 2dp (got ${nr.text})`);

    // The value is NEVER accepted from the caller — swapping points keeps |Δ|.
    const rev = linearDimension(100, 0, 0, 0, { orientation: 'horizontal' });
    assert(rev.value === 100 && rev.text === '100', 'reversed points still measure 100 (absolute)');

    // Prefix/suffix wrap the measured value, they do not replace it.
    const pref = linearDimension(0, 0, 12, 0, { orientation: 'horizontal', suffix: ' TYP' });
    assert(pref.text === '12 TYP', 'suffix appends to the measured value');
  }

  // ─── Dimension geometry is present ───────────────────────────────
  {
    const h = linearDimension(0, 0, 100, 0, { orientation: 'horizontal', textHeight: 2.5, arrowSize: 2.5 });
    const lines = h.entities.filter((e) => e.kind === 'line');
    const texts = h.entities.filter((e) => e.kind === 'text');
    // 2 extension + 1 dimension + 2 arrows × 2 caret lines = 7 lines, 1 text.
    assert(lines.length === 7, `horizontal dim has 7 lines (2 ext + 1 dim + 4 arrow), got ${lines.length}`);
    assert(texts.length === 1, 'horizontal dim has exactly 1 text');
    assert(h.entities.every((e) => e.layer === DIMS_LAYER), 'all dim entities on the DIMS layer');
  }

  // ─── Diameter / radius callouts ──────────────────────────────────
  {
    const d = diameterDimension(0, 0, 10);
    assert(d.value === 20 && d.text === 'Ø20', 'diameter of r=10 → Ø20');
    const r = radiusDimension(5, 5, 8);
    assert(r.value === 8 && r.text === 'R8', 'radius r=8 → R8');
    assert(d.entities.some((e) => e.kind === 'text' && e.text === 'Ø20'), 'Ø text entity present');
  }

  // ─── Title block ─────────────────────────────────────────────────
  {
    const tb = titleBlock({ name: 'BRACKET-01', material: 'Steel', drawnBy: 'ACME', scale: '1:2', tolerance: '±0.05' });
    const values = tb.filter((e) => e.kind === 'text').map((e: any) => e.text as string);
    assert(values.includes('BRACKET-01'), 'title block shows the drawing name');
    assert(values.includes('Steel') && values.includes('±0.05'), 'title block shows material + tolerance');
    assert(values.includes('DRAWING') && values.includes('MATERIAL'), 'title block has field labels');
    const lines = tb.filter((e) => e.kind === 'line');
    assert(lines.length >= 4, 'title block has a border box (≥4 lines)');
    // A field value containing a newline must be flattened (no DXF tag break).
    const hostile = titleBlock({ name: 'A\nB\n0\nLINE' });
    assert((hostile.find((e: any) => e.kind === 'text' && /A/.test(e.text)) as any)?.text.indexOf('\n') === -1, 'newline in a field is stripped');
  }

  console.log(`\n${passed} assertions passed, ${failures.length} failed`);
  if (failures.length) { console.error(`\n${failures.length} engineering-dimension-core smoke failure(s)`); process.exit(1); }
  console.log('All engineering-dimension-core smoke cases passed.');
}

main();
