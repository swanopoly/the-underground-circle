/**
 * tool-catalog-manifest-core-smoketest — the pure single-source tool-catalog
 * normalizer (src/lib/toolCatalogManifestCore.ts) behind ADD #2 of
 * docs/CHAT_ARCHITECTURE_STRATEGIC_PLAN_2026-07-15.md: BOTH the RN app
 * (openswanToolRuntime) and the Deno edge (swanbot-v2-ai) derive the SAME
 * canonical manifest row from a tool definition, and a CI drift check proves
 * parity. Load-bearing assertions:
 *
 *   deriveToolManifestEntry: a realistic app-side def (merged def+policy+
 *   disclosure) → correct row; an 'ask' + mutating tool → approvalMode 'ask' +
 *   mutates true; a tool with no disclosure → disclosure 'deferred' (fail
 *   closed); per-tool disclosure override honored; family is ALWAYS the name
 *   prefix (explicit `family` field ignored); fail-closed defaults for a bare
 *   edge def (missing approvalMode → 'ask', missing disclosure → 'deferred');
 *   hasSchema true only for a non-empty schema object under any surface field
 *   name; summary comes from summary/description/label (never schema values)
 *   and is length-bounded; junk → null.
 *
 *   buildToolManifest: maps a list; dedupes by name (first wins) preserving
 *   order; drops junk; non-array → []; caps at MAX_MANIFEST_ENTRIES.
 *
 *   diffToolManifests: flags onlyInA + onlyInB + a policy change as 'changed';
 *   identical manifests → empty diff; approvalMode/disclosure/mutates each
 *   trigger 'changed'; summary/hasSchema drift does NOT; accepts raw def lists
 *   or already-built manifests; output sorted.
 *
 *   And a hostile group: cyclic / huge / symbol / function / NaN / weird input
 *   never throws and returns a safe neutral.
 *
 * Pure — loads under tsx (toolCatalogManifestCore has zero imports).
 */

import {
  deriveToolManifestEntry,
  buildToolManifest,
  diffToolManifests,
  MAX_MANIFEST_ENTRIES,
  MAX_TOOL_NAME_CHARS,
  MAX_TOOL_SUMMARY_CHARS,
  type ToolManifestEntry,
} from '../src/lib/toolCatalogManifestCore';

let passes = 0;
let failures = 0;
function assert(cond: unknown, msg: string, extra?: string): void {
  if (cond) passes += 1;
  else { failures += 1; console.error(`FAIL: ${msg}${extra ? ` :: ${extra}` : ''}`); }
}
function assertEq(a: unknown, b: unknown, msg: string): void {
  assert(a === b, msg, `got ${JSON.stringify(a)} want ${JSON.stringify(b)}`);
}
function assertDeep(a: unknown, b: unknown, msg: string): void {
  assertEq(JSON.stringify(a), JSON.stringify(b), msg);
}

// ── Realistic fixtures mirroring the two surfaces ───────────────────────────

// App-side MERGED view (OpenSwanToolDefinition + getOpenSwanToolPolicy fields +
// getOpenSwanToolDisclosure) — what the app wiring would hand this core.
const appFetchUrl = {
  name: 'fetch_url',
  label: 'Fetch URL',
  surfaces: ['main_chat', 'room_chat'],
  description: 'Reads a public external URL.',
  inputSchema: { type: 'object', properties: { url: { type: 'string' } }, required: ['url'] },
  approvalMode: 'auto',
  mutatesState: false,
  externalSideEffect: true,
  disclosure: 'pinned',
};

// 'ask' + mutating credential fill (browser.fill_credential_field shape).
const appFillCredential = {
  name: 'browser.fill_credential_field',
  label: 'Fill Credential Field',
  surfaces: ['main_chat'],
  description: 'Fills a browser login field from a saved credential without returning raw secret values to the model. Requires approval.',
  inputSchema: { type: 'object', properties: { credentialId: { type: 'string' } }, required: ['credentialId'] },
  approvalMode: 'ask',
  mutatesState: true,
  disclosure: 'deferred',
};

// Deferred-by-default desktop tool (no `disclosure` field → family default).
const appDesktopLaunch = {
  name: 'desktop.launch_app',
  label: 'Launch App',
  surfaces: ['main_chat'],
  description: 'Launches a local desktop application.',
  approvalMode: 'ask',
  mutatesState: true,
  // no disclosure → fail-closed 'deferred'
};

// Pinned per-tool override (browser.plan_task shape: family browser is
// deferred, but the tool pins itself).
const appPlanTask = {
  name: 'browser.plan_task',
  label: 'Plan Browser Task',
  surfaces: ['main_chat'],
  description: 'Plans browser automation and approval gates without executing live actions.',
  inputSchema: { type: 'object', properties: { task: { type: 'string' } }, required: ['task'] },
  approvalMode: 'auto',
  mutatesState: false,
  disclosure: 'pinned',
};

// Edge-side bare ToolDef (Anthropic format, NO policy/disclosure) for fetch_url.
const edgeFetchUrl = {
  name: 'fetch_url',
  description: 'Fetch a URL.',
  input_schema: { type: 'object', properties: { url: { type: 'string' } } },
};

function main(): void {
  // ── Group 1: realistic app-side def → correct canonical row ──────────────
  {
    const e = deriveToolManifestEntry(appFetchUrl);
    assert(e !== null, '(1) fetch_url derives an entry');
    assertEq(e?.name, 'fetch_url', '(1) name');
    assertEq(e?.family, 'fetch_url', '(1) flat-tool family = full name');
    assertEq(e?.approvalMode, 'auto', '(1) approvalMode auto');
    assertEq(e?.disclosure, 'pinned', '(1) disclosure pinned');
    assertEq(e?.mutates, false, '(1) mutates false (mutatesState:false)');
    assertEq(e?.hasSchema, true, '(1) hasSchema true (non-empty inputSchema)');
    assertEq(e?.summary, 'Reads a public external URL.', '(1) summary from description');
    // Exactly the canonical shape, no extra fields leaked (e.g. externalSideEffect).
    assertDeep(Object.keys(e as object).sort(),
      ['approvalMode', 'disclosure', 'family', 'hasSchema', 'mutates', 'name', 'summary'],
      '(1) entry has exactly the 7 canonical keys');
  }

  // ── Group 2: 'ask' + mutating tool → approvalMode 'ask' + mutates true ───
  {
    const e = deriveToolManifestEntry(appFillCredential);
    assertEq(e?.name, 'browser.fill_credential_field', '(2) name');
    assertEq(e?.family, 'browser', '(2) dotted-tool family = prefix');
    assertEq(e?.approvalMode, 'ask', '(2) approvalMode ask');
    assertEq(e?.mutates, true, '(2) mutates true');
    assertEq(e?.disclosure, 'deferred', '(2) disclosure deferred');
    assertEq(e?.hasSchema, true, '(2) hasSchema true');
  }

  // ── Group 3: disclosure — default 'deferred' vs per-tool override ────────
  {
    const def = deriveToolManifestEntry(appDesktopLaunch);
    assertEq(def?.disclosure, 'deferred', '(3) no disclosure field → fail-closed deferred');
    assertEq(def?.family, 'desktop', '(3) family desktop');
    const pin = deriveToolManifestEntry(appPlanTask);
    assertEq(pin?.disclosure, 'pinned', '(3) per-tool disclosure override honored');
    assertEq(pin?.family, 'browser', '(3) plan_task family browser');
    // invalid disclosure string also fails closed
    const bad = deriveToolManifestEntry({ name: 'x.y', disclosure: 'sometimes' });
    assertEq(bad?.disclosure, 'deferred', '(3) invalid disclosure → deferred');
  }

  // ── Group 4: family is ALWAYS name-derived (explicit field ignored) ──────
  {
    // A 'desktop.*' tool whose POLICY family is 'browser' must still bucket to
    // the NAME family 'desktop' — else app↔edge would falsely diverge.
    const e = deriveToolManifestEntry({ name: 'desktop.photoshop_export', family: 'browser', approvalMode: 'ask' });
    assertEq(e?.family, 'desktop', '(4) explicit family field ignored — name prefix wins');
    assertEq(deriveToolManifestEntry({ name: 'save_memory' })?.family, 'save_memory', '(4) flat family = whole name');
    assertEq(deriveToolManifestEntry({ name: 'gmail.read' })?.family, 'gmail', '(4) gmail.read → gmail');
    // leading dot → dot at index 0 → not > 0 → whole name is the family
    assertEq(deriveToolManifestEntry({ name: '.hidden' })?.family, '.hidden', '(4) leading-dot name → whole name family');
    // multiple dots → only first segment
    assertEq(deriveToolManifestEntry({ name: 'a.b.c' })?.family, 'a', '(4) multi-dot → first segment');
  }

  // ── Group 5: fail-closed defaults for a bare edge def ────────────────────
  {
    const e = deriveToolManifestEntry(edgeFetchUrl);
    assertEq(e?.name, 'fetch_url', '(5) edge name');
    assertEq(e?.approvalMode, 'ask', '(5) missing approvalMode → fail-closed ask');
    assertEq(e?.disclosure, 'deferred', '(5) missing disclosure → fail-closed deferred');
    assertEq(e?.mutates, false, '(5) missing mutates → false');
    assertEq(e?.hasSchema, true, '(5) edge input_schema → hasSchema true');
    assertEq(e?.summary, 'Fetch a URL.', '(5) summary from description');
    // invalid approvalMode value also fails closed
    assertEq(deriveToolManifestEntry({ name: 't', approvalMode: 'maybe' })?.approvalMode, 'ask', '(5) invalid approvalMode → ask');
    assertEq(deriveToolManifestEntry({ name: 't', approvalMode: 'auto' })?.approvalMode, 'auto', '(5) valid auto passthrough');
  }

  // ── Group 6: hasSchema across surface field names + emptiness ────────────
  {
    assertEq(deriveToolManifestEntry({ name: 't', inputSchema: { type: 'object', properties: { a: {} } } })?.hasSchema, true, '(6) inputSchema non-empty → true');
    assertEq(deriveToolManifestEntry({ name: 't', input_schema: { type: 'object' } })?.hasSchema, true, '(6) input_schema present → true');
    assertEq(deriveToolManifestEntry({ name: 't', parameters: { type: 'object', properties: {} } })?.hasSchema, true, '(6) parameters present → true');
    assertEq(deriveToolManifestEntry({ name: 't', inputSchema: {} })?.hasSchema, false, '(6) empty {} schema → false');
    assertEq(deriveToolManifestEntry({ name: 't' })?.hasSchema, false, '(6) no schema → false');
    assertEq(deriveToolManifestEntry({ name: 't', inputSchema: 'nope' })?.hasSchema, false, '(6) non-object schema → false');
    // explicit boolean passthrough (lets a built entry round-trip)
    assertEq(deriveToolManifestEntry({ name: 't', hasSchema: true })?.hasSchema, true, '(6) explicit hasSchema:true passthrough');
    assertEq(deriveToolManifestEntry({ name: 't', hasSchema: false })?.hasSchema, false, '(6) explicit hasSchema:false');
    // a real schema object wins over a stale explicit boolean
    assertEq(deriveToolManifestEntry({ name: 't', inputSchema: { properties: { a: {} } }, hasSchema: false })?.hasSchema, true, '(6) schema object beats explicit boolean');
  }

  // ── Group 7: summary priority, bounding, and secret-safety ───────────────
  {
    assertEq(deriveToolManifestEntry({ name: 't', summary: 'S', description: 'D', label: 'L' })?.summary, 'S', '(7) summary field wins');
    assertEq(deriveToolManifestEntry({ name: 't', description: 'D', label: 'L' })?.summary, 'D', '(7) description second');
    assertEq(deriveToolManifestEntry({ name: 't', label: 'L' })?.summary, 'L', '(7) label third');
    assertEq(deriveToolManifestEntry({ name: 't' })?.summary, '', '(7) no text → empty summary');
    assertEq(deriveToolManifestEntry({ name: 't', summary: '   ' })?.summary, '', '(7) whitespace summary → empty (falls through)');
    assertEq(deriveToolManifestEntry({ name: 't', summary: '  hi  ' })?.summary, 'hi', '(7) summary trimmed');
    assertEq(deriveToolManifestEntry({ name: 't', summary: 123 })?.summary, '', '(7) non-string summary ignored');
    // bounding
    const long = 'x'.repeat(500);
    const e = deriveToolManifestEntry({ name: 't', description: long });
    assert((e?.summary.length ?? 0) <= MAX_TOOL_SUMMARY_CHARS, '(7) summary length bounded');
    assert(e?.summary.endsWith('…'), '(7) truncated summary ends with ellipsis');
    // secret-safety: schema property values/keys/examples must NOT appear in summary
    const secretish = deriveToolManifestEntry({
      name: 'vault.reveal',
      description: 'Reveals a stored credential value.',
      inputSchema: { type: 'object', properties: { token: { type: 'string', description: 'sk-SECRET-EXAMPLE', example: 'sk-live-DEADBEEF', default: 'TOPSECRET' } } },
    });
    assertEq(secretish?.summary, 'Reveals a stored credential value.', '(7) summary is authored description');
    assert(!secretish?.summary.includes('sk-live'), '(7) summary does not leak schema example');
    assert(!secretish?.summary.includes('SECRET'), '(7) summary does not leak schema value');
    assert(!secretish?.summary.includes('token'), '(7) summary does not leak schema key');
    assert(!secretish?.summary.includes('TOPSECRET'), '(7) summary does not leak schema default');
    assertEq(secretish?.hasSchema, true, '(7) secretish still records hasSchema true (presence only)');
  }

  // ── Group 8: junk → null ─────────────────────────────────────────────────
  {
    assertEq(deriveToolManifestEntry(null), null, '(8) null → null');
    assertEq(deriveToolManifestEntry(undefined), null, '(8) undefined → null');
    assertEq(deriveToolManifestEntry(42), null, '(8) number → null');
    assertEq(deriveToolManifestEntry('fetch_url'), null, '(8) bare string → null');
    assertEq(deriveToolManifestEntry(true), null, '(8) boolean → null');
    assertEq(deriveToolManifestEntry([]), null, '(8) array → null');
    assertEq(deriveToolManifestEntry([{ name: 'x' }]), null, '(8) array of defs → null (not a def)');
    assertEq(deriveToolManifestEntry({}), null, '(8) no name → null');
    assertEq(deriveToolManifestEntry({ name: 123 }), null, '(8) non-string name → null');
    assertEq(deriveToolManifestEntry({ name: '' }), null, '(8) empty name → null');
    assertEq(deriveToolManifestEntry({ name: '   ' }), null, '(8) whitespace name → null');
    assertEq(deriveToolManifestEntry({ name: 'x'.repeat(MAX_TOOL_NAME_CHARS + 1) }), null, '(8) over-long name → null');
    assert(deriveToolManifestEntry({ name: 'x'.repeat(MAX_TOOL_NAME_CHARS) }) !== null, '(8) name at cap is accepted');
    // name is trimmed on the way in
    assertEq(deriveToolManifestEntry({ name: '  tasks.list  ' })?.name, 'tasks.list', '(8) name trimmed');
  }

  // ── Group 9: buildToolManifest — map, dedupe, order, cap, junk ───────────
  {
    const m = buildToolManifest([appFetchUrl, appFillCredential, appDesktopLaunch]);
    assertEq(m.length, 3, '(9) three defs → three entries');
    assertDeep(m.map((e) => e.name), ['fetch_url', 'browser.fill_credential_field', 'desktop.launch_app'], '(9) input order preserved');
    // dedupe: first occurrence wins
    const dup = buildToolManifest([
      { ...appFetchUrl, description: 'FIRST' },
      { ...appFetchUrl, description: 'SECOND', approvalMode: 'ask' },
      appFillCredential,
    ]);
    assertEq(dup.length, 2, '(9) duplicate name collapses');
    assertEq(dup[0].name, 'fetch_url', '(9) first fetch_url kept');
    assertEq(dup[0].summary, 'FIRST', '(9) FIRST occurrence wins on dedupe');
    assertEq(dup[0].approvalMode, 'auto', '(9) dedupe keeps first policy, not later');
    // junk rows skipped, valid kept
    const mixed = buildToolManifest([null, appFetchUrl, 7, {}, 'x', appFillCredential, { name: '' }]);
    assertEq(mixed.length, 2, '(9) junk rows dropped, valid kept');
    // non-array inputs → []
    assertDeep(buildToolManifest(null), [], '(9) null → []');
    assertDeep(buildToolManifest(undefined), [], '(9) undefined → []');
    assertDeep(buildToolManifest('nope'), [], '(9) string → []');
    assertDeep(buildToolManifest({ name: 'x' }), [], '(9) object (non-array) → []');
    assertDeep(buildToolManifest([]), [], '(9) empty array → []');
    // cap at MAX_MANIFEST_ENTRIES
    const many: unknown[] = [];
    for (let i = 0; i < MAX_MANIFEST_ENTRIES + 250; i += 1) many.push({ name: `tool_${i}` });
    const capped = buildToolManifest(many);
    assertEq(capped.length, MAX_MANIFEST_ENTRIES, '(9) manifest capped at MAX_MANIFEST_ENTRIES');
    assertEq(capped[0].name, 'tool_0', '(9) cap keeps the first entries (stable prefix)');
  }

  // ── Group 10: diffToolManifests — the drift detector ─────────────────────
  {
    const A = [
      { name: 'a', approvalMode: 'auto', disclosure: 'pinned', mutatesState: false },
      { name: 'b', approvalMode: 'ask', disclosure: 'deferred', mutatesState: true },
      { name: 'c', approvalMode: 'auto', disclosure: 'pinned', mutatesState: false },
    ];
    const B = [
      { name: 'a', approvalMode: 'auto', disclosure: 'pinned', mutatesState: false },
      { name: 'b', approvalMode: 'auto', disclosure: 'deferred', mutatesState: true }, // approvalMode changed
      { name: 'd', approvalMode: 'auto', disclosure: 'pinned', mutatesState: false },
    ];
    const d = diffToolManifests(A, B);
    assertDeep(d.onlyInA, ['c'], '(10) onlyInA flags c');
    assertDeep(d.onlyInB, ['d'], '(10) onlyInB flags d');
    assertDeep(d.changed, ['b'], '(10) approvalMode change flags b as changed');

    // identical manifests → empty diff
    const same = diffToolManifests(A, A);
    assertDeep(same, { onlyInA: [], onlyInB: [], changed: [] }, '(10) identical → empty diff');

    // disclosure-only change → changed
    const discl = diffToolManifests(
      [{ name: 'x', approvalMode: 'auto', disclosure: 'pinned' }],
      [{ name: 'x', approvalMode: 'auto', disclosure: 'deferred' }],
    );
    assertDeep(discl.changed, ['x'], '(10) disclosure change → changed');

    // mutates-only change → changed
    const mut = diffToolManifests(
      [{ name: 'x', approvalMode: 'auto', disclosure: 'pinned', mutatesState: false }],
      [{ name: 'x', approvalMode: 'auto', disclosure: 'pinned', mutatesState: true }],
    );
    assertDeep(mut.changed, ['x'], '(10) mutates change → changed');

    // summary + hasSchema drift does NOT count as changed (excluded from parity)
    const cosmetic = diffToolManifests(
      [{ name: 'x', approvalMode: 'auto', disclosure: 'pinned', description: 'wording one', inputSchema: { properties: { a: {} } } }],
      [{ name: 'x', approvalMode: 'auto', disclosure: 'pinned', description: 'totally different wording', hasSchema: false }],
    );
    assertDeep(cosmetic, { onlyInA: [], onlyInB: [], changed: [] }, '(10) summary/hasSchema drift is NOT policy drift');

    // real app↔edge: bare edge fetch_url drifts from the app's policy view
    const appEdge = diffToolManifests([appFetchUrl], [edgeFetchUrl]);
    assertDeep(appEdge.changed, ['fetch_url'], '(10) bare edge def drifts from app policy (auto/pinned vs ask/deferred)');

    // output is sorted regardless of input order
    const sorted = diffToolManifests(
      [{ name: 'zeta' }, { name: 'alpha' }, { name: 'mike' }],
      [],
    );
    assertDeep(sorted.onlyInA, ['alpha', 'mike', 'zeta'], '(10) onlyInA sorted');

    // accepts already-built manifests on either side (idempotent round-trip)
    const built = buildToolManifest(A);
    assertDeep(diffToolManifests(built, A), { onlyInA: [], onlyInB: [], changed: [] }, '(10) built manifest vs raw defs → no drift');
    const built2 = buildToolManifest(built);
    assertDeep(built2, built, '(10) buildToolManifest is idempotent on its own output');

    // both empty / non-array → empty neutral diff
    assertDeep(diffToolManifests([], []), { onlyInA: [], onlyInB: [], changed: [] }, '(10) empty vs empty → empty');
    assertDeep(diffToolManifests(null, undefined), { onlyInA: [], onlyInB: [], changed: [] }, '(10) junk vs junk → empty');
    assertDeep(diffToolManifests([appFetchUrl], null).onlyInA, ['fetch_url'], '(10) A vs junk → all A onlyInA');
    assertDeep(diffToolManifests(null, [appFetchUrl]).onlyInB, ['fetch_url'], '(10) junk vs B → all B onlyInB');
  }

  // ── Group 11: HOSTILE — degenerate/cyclic/huge/weird never throws ────────
  try {
    // cyclic def object
    const cyclic: Record<string, unknown> = { name: 'cyc.tool', approvalMode: 'ask' };
    cyclic.self = cyclic;
    const ce = deriveToolManifestEntry(cyclic);
    assertEq(ce?.name, 'cyc.tool', '(11) cyclic def → still derives');
    assertEq(ce?.approvalMode, 'ask', '(11) cyclic def reads fields fine');

    // cyclic inputSchema
    const cyclicSchema: Record<string, unknown> = { a: 1 };
    cyclicSchema.loop = cyclicSchema;
    assertEq(deriveToolManifestEntry({ name: 't', inputSchema: cyclicSchema })?.hasSchema, true, '(11) cyclic schema → hasSchema true, no hang');

    // schema whose enumerable key throws on access (hostile getter)
    const hostileSchema: Record<string, unknown> = {};
    Object.defineProperty(hostileSchema, 'boom', { enumerable: true, get() { throw new Error('no'); } });
    assert(typeof deriveToolManifestEntry({ name: 't', inputSchema: hostileSchema })?.hasSchema === 'boolean', '(11) hostile-getter schema → boolean, no throw');

    // exotic field types
    assert(deriveToolManifestEntry({ name: 't', approvalMode: Symbol('x') as unknown, disclosure: 123 as unknown, mutatesState: 'yes' as unknown }) !== null, '(11) exotic field types tolerated');
    assertEq(deriveToolManifestEntry({ name: 't', mutatesState: 'yes' as unknown })?.mutates, false, '(11) non-boolean mutatesState → false');
    assertEq(deriveToolManifestEntry({ name: 't', mutates: 1 as unknown })?.mutates, false, '(11) non-boolean mutates → false');

    // NaN / function / symbol as whole def
    assertEq(deriveToolManifestEntry(NaN), null, '(11) NaN → null');
    assertEq(deriveToolManifestEntry((() => 0) as unknown), null, '(11) function → null');
    assertEq(deriveToolManifestEntry(Symbol('s') as unknown), null, '(11) symbol → null');

    // huge name / huge summary
    assertEq(deriveToolManifestEntry({ name: 'z'.repeat(100000) }), null, '(11) 100k-char name → null');
    const bigSummary = deriveToolManifestEntry({ name: 't', summary: 'y'.repeat(100000) });
    assert((bigSummary?.summary.length ?? 0) <= MAX_TOOL_SUMMARY_CHARS, '(11) 100k-char summary bounded');

    // buildToolManifest over a hostile mixed list
    const hostileList = [null, undefined, NaN, 'x', 7, [], {}, cyclic, { name: 't' }, Symbol('s')];
    const hm = buildToolManifest(hostileList as unknown);
    assert(Array.isArray(hm), '(11) buildToolManifest hostile list → array');
    assert(hm.length >= 2 && hm.length <= hostileList.length, '(11) hostile list keeps only valid rows');

    // array-of-array, deeply nested, and a Map/Set as inputs
    assertDeep(buildToolManifest(new Map() as unknown), [], '(11) Map input → []');
    assertDeep(buildToolManifest(new Set([1, 2]) as unknown), [], '(11) Set input → []');
    assert(Array.isArray(buildToolManifest([[{ name: 'nested' }]] as unknown)), '(11) array-of-array → array (inner arrays are junk rows)');

    // diff with cyclic + hostile inputs never throws
    const d1 = diffToolManifests(cyclic, [cyclic]);
    assert(Array.isArray(d1.onlyInA) && Array.isArray(d1.changed), '(11) diff with cyclic → shaped neutral');
    const d2 = diffToolManifests([cyclic, { name: 't' }], [{ name: 't', approvalMode: 'auto', disclosure: 'pinned' }]);
    assert(Array.isArray(d2.changed), '(11) diff hostile → array');
    assertDeep(diffToolManifests(42 as unknown, 'x' as unknown), { onlyInA: [], onlyInB: [], changed: [] }, '(11) diff(number,string) → empty neutral');

    passes += 1; // group-level "nothing threw" tick
  } catch (e) {
    failures += 1;
    console.error(`FAIL: (11) hostile inputs threw: ${(e as Error)?.message}`);
  }

  // ── Group 12: type-contract sanity (compile-time shape used at runtime) ──
  {
    const entry: ToolManifestEntry | null = deriveToolManifestEntry(appPlanTask);
    assert(entry !== null && typeof entry.name === 'string', '(12) entry.name is string');
    assert(entry !== null && (entry.approvalMode === 'auto' || entry.approvalMode === 'ask'), '(12) approvalMode is enum');
    assert(entry !== null && (entry.disclosure === 'pinned' || entry.disclosure === 'deferred'), '(12) disclosure is enum');
    assert(entry !== null && typeof entry.mutates === 'boolean', '(12) mutates is boolean');
    assert(entry !== null && typeof entry.hasSchema === 'boolean', '(12) hasSchema is boolean');
  }

  if (failures > 0) {
    console.error(`\n${failures} fail`);
    process.exit(1);
  }
  console.log(`\nAll tool-catalog-manifest-core smoke cases passed (${passes} passed).`);
}

main();
