/**
 * tool-connectivity-gate-core-smoketest — the PURE, pre-dispatch tool-catalog
 * GATE (src/lib/toolConnectivityGateCore.ts) that withholds a tool ONLY when the
 * external prerequisite it needs is EXPLICITLY not connected. Load-bearing
 * assertions:
 *
 *   TRISTATE + FAIL OPEN: a prereq resolves to true (available) / false (GATED -
 *   the only thing that gates) / unknown-by-absence (available). No matching
 *   rule -> available. 'gmail.send' with {google:false} -> gated 'google.gmail';
 *   with {google:true} -> available; with {google:true,googleServices:{gmail:
 *   false}} -> gated; with {} -> available. browser/desktop/vault/wordpress
 *   mirror this; wordpress falls back to integrations.wordpress.
 *
 *   SPECIFICITY: an exact-name rule beats a family prefix
 *   (browser.fill_credential_field needs the VAULT, not the browser); a caller
 *   extraRule overrides a default on a specificity tie.
 *
 *   PARTITION: gateToolNames splits candidates into available/gated, deduped,
 *   input-order stable; note is bounded <= MAX_NOTE_LEN and carries only fixed
 *   capability LABELS (never a boolean or snapshot token).
 *
 *   And: every export is TOTAL - null/undefined/number/array/function/NaN/huge/
 *   control-char/cyclic/throwing-getter input never throws and fails OPEN.
 *
 * Pure - loads under tsx (toolConnectivityGateCore has zero imports).
 */

import {
  classifyToolConnectivity,
  gateToolNames,
  isToolConnectionGated,
  summarizeGates,
  DEFAULT_TOOL_PREREQ_RULES,
  MAX_CANDIDATES,
  MAX_RULES_SCANNED,
  MAX_TOOL_NAME_LEN,
  MAX_MATCH_LEN,
  MAX_CAP_LEN,
  MAX_HINT_LEN,
  MAX_NOTE_LEN,
  type ConnectivitySnapshot,
  type ToolPrereqRule,
  type ToolConnectivityVerdict,
  type GateResult,
} from '../src/lib/toolConnectivityGateCore';

let passes = 0;
let failures = 0;
function assert(cond: unknown, msg: string, extra?: string): void {
  if (cond) passes += 1;
  else {
    failures += 1;
    console.error(`FAIL: ${msg}${extra ? ` :: ${extra}` : ''}`);
  }
}
function assertEq(a: unknown, b: unknown, msg: string): void {
  assert(a === b, msg, `got ${JSON.stringify(a)} want ${JSON.stringify(b)}`);
}
function assertJson(a: unknown, b: unknown, msg: string): void {
  assert(JSON.stringify(a) === JSON.stringify(b), msg, `got ${JSON.stringify(a)} want ${JSON.stringify(b)}`);
}

// -- helpers -------------------------------------------------------------------
function status(tool: unknown, snap: unknown, opts?: unknown): string {
  return classifyToolConnectivity(tool, snap as ConnectivitySnapshot, opts as never).status;
}
function missing(tool: unknown, snap: unknown, opts?: unknown): string | undefined {
  return classifyToolConnectivity(tool, snap as ConnectivitySnapshot, opts as never).missing;
}
/** No-throw probe returning true iff every export ran without throwing. */
function totalOn(tool: unknown, snap: unknown): boolean {
  try {
    classifyToolConnectivity(tool, snap as never);
    isToolConnectionGated(tool, snap as never);
    gateToolNames([tool], snap as never);
    gateToolNames(tool, snap as never);
    summarizeGates(tool);
    return true;
  } catch {
    return false;
  }
}

function main(): void {
  // -- (1) Google family - tristate + fail open --------------------------------
  assertEq(status('gmail.send', { google: false }), 'gated', '(1) gmail gated when google explicitly off');
  assertEq(missing('gmail.send', { google: false }), 'google.gmail', '(1) missing capability is the gmail service');
  assertEq(status('gmail.send', { google: true }), 'available', '(1) gmail available when google on (service unknown)');
  assertEq(status('gmail.send', { google: true, googleServices: { gmail: false } }), 'gated', '(1) service-level off gates');
  assertEq(status('gmail.send', { google: true, googleServices: { gmail: true } }), 'available', '(1) service-level on available');
  assertEq(status('gmail.send', {}), 'available', '(1) empty snapshot -> unknown -> available (fail open)');
  assertEq(status('gmail.send', { googleServices: { gmail: false } }), 'gated', '(1) service off gates even w/o google flag');
  assertEq(status('gmail.send', { google: false, googleServices: { gmail: true } }), 'gated', '(1) google:false overrides service:true');
  assertEq(status('gcal.list', { google: false }), 'gated', '(1) gcal gated');
  assertEq(missing('gcal.list', { google: false }), 'google.calendar', '(1) gcal -> calendar capability');
  assertEq(status('gsheets.read', { google: false }), 'gated', '(1) gsheets gated');
  assertEq(missing('gsheets.read', { google: false }), 'google.sheets', '(1) gsheets -> sheets capability');
  assertEq(status('gdocs.append', { google: false }), 'gated', '(1) gdocs gated');
  assertEq(missing('gdocs.append', { google: false }), 'google.docs', '(1) gdocs -> docs capability');
  assertEq(status('gdrive.list', { google: false }), 'gated', '(1) gdrive gated');
  assertEq(missing('gdrive.list', { google: false }), 'google.drive', '(1) gdrive -> drive capability');

  // -- (2) browser / desktop / vault / wordpress -------------------------------
  assertEq(status('browser.open_url', { browser: false }), 'gated', '(2) browser gated when no provider');
  assertEq(missing('browser.open_url', { browser: false }), 'browser', '(2) browser missing capability');
  assertEq(status('browser.open_url', { browser: true }), 'available', '(2) browser available when connected');
  assertEq(status('browser.open_url', {}), 'available', '(2) browser unknown -> available');
  assertEq(status('desktop.launch_app', { desktopBridge: false }), 'gated', '(2) desktop gated when bridge offline');
  assertEq(missing('desktop.launch_app', { desktopBridge: false }), 'desktopBridge', '(2) desktop missing capability');
  assertEq(status('desktop.launch_app', { desktopBridge: true }), 'available', '(2) desktop available when bridge up');
  assertEq(status('credentials.get', { vault: false }), 'gated', '(2) credentials.get gated when vault empty');
  assertEq(missing('credentials.get', { vault: false }), 'vault', '(2) credentials.get -> vault');
  assertEq(status('credentials.get', { vault: true }), 'available', '(2) credentials.get available when vault has creds');
  assertEq(status('credentials.list', { vault: false }), 'available', '(2) only credentials.get is gated (list has no rule)');
  assertEq(status('wp.list_posts', { wordpress: false }), 'gated', '(2) wp gated by direct wordpress:false');
  assertEq(status('wp.list_posts', { integrations: { wordpress: false } }), 'gated', '(2) wp gated by integrations fallback');
  assertEq(status('wp.list_posts', { wordpress: true }), 'available', '(2) wp available when connected');
  assertEq(status('wp.list_posts', { wordpress: true, integrations: { wordpress: false } }), 'available', '(2) direct wordpress:true wins over integrations:false');
  assertEq(status('wp.list_posts', {}), 'available', '(2) wp unknown -> available');

  // -- (3) no matching rule -> always available --------------------------------
  assertEq(status('tasks.list', { google: false, browser: false, vault: false }), 'available', '(3) unmatched tool always available');
  assertEq(status('memory.save', {}), 'available', '(3) base tool available');
  assertEq(status('rooms.post', { wordpress: false }), 'available', '(3) unrelated tool ignores unrelated off-flag');
  assertJson(classifyToolConnectivity('tasks.list', { google: false }), { tool: 'tasks.list', status: 'available' }, '(3) verdict has no missing/hint when available');

  // -- (4) specificity - exact beats family prefix -----------------------------
  // browser.fill_credential_field needs the VAULT (exact rule), not the browser.
  assertEq(status('browser.fill_credential_field', { browser: true, vault: false }), 'gated', '(4) exact vault rule gates even when browser is up');
  assertEq(missing('browser.fill_credential_field', { browser: true, vault: false }), 'vault', '(4) exact rule capability is vault, not browser');
  assertEq(status('browser.fill_credential_field', { browser: false, vault: true }), 'available', '(4) exact rule ignores browser:false (needs vault, which is up)');
  assertEq(status('browser.fill_credential_field', { browser: false, vault: false }), 'gated', '(4) still gated on vault when both off');
  assertEq(missing('browser.click', { browser: false, vault: false }), 'browser', '(4) non-exact browser tool uses prefix rule');

  // -- (5) extraRules - marketplace tokens + tie override ----------------------
  const slackRule: ToolPrereqRule = { match: 'slack.', capability: 'slack', hint: 'Connect Slack first.' };
  assertEq(status('slack.send', { integrations: { slack: false } }, { extraRules: [slackRule] }), 'gated', '(5) extra slack rule gates on integrations.slack:false');
  assertEq(missing('slack.send', { integrations: { slack: false } }, { extraRules: [slackRule] }), 'slack', '(5) extra rule missing capability');
  assertEq(status('slack.send', { integrations: { slack: true } }, { extraRules: [slackRule] }), 'available', '(5) extra slack rule available when connected');
  assertEq(status('slack.send', {}, { extraRules: [slackRule] }), 'available', '(5) extra rule unknown -> available');
  assertEq(status('slack.send', { integrations: { slack: false } }), 'available', '(5) without the extra rule slack has no prereq -> available');
  // tie override: an extraRule with the SAME match as a default wins.
  const overrideVault: ToolPrereqRule = { match: 'credentials.get', capability: 'vault', hint: 'custom vault hint' };
  const ov = classifyToolConnectivity('credentials.get', { vault: false }, { extraRules: [overrideVault] });
  assertEq(ov.status, 'gated', '(5) tie override still gates');
  assertEq(ov.hint, 'custom vault hint', '(5) extraRule overrides default hint on tie');
  // a more-specific default beats a less-specific extra (exact > prefix).
  const looseBrowser: ToolPrereqRule = { match: 'browser.', capability: 'browser', hint: 'x' };
  assertEq(missing('browser.fill_credential_field', { browser: false, vault: false }, { extraRules: [looseBrowser] }), 'vault', '(5) exact default beats less-specific extra prefix');

  // -- (6) gateToolNames - partition, dedup, order, note -----------------------
  const snap6: ConnectivitySnapshot = { google: false, browser: false, vault: true };
  const candidates6 = ['tasks.list', 'gmail.send', 'browser.open_url', 'memory.save', 'credentials.get', 'gcal.list'];
  const res6 = gateToolNames(candidates6, snap6);
  assertJson(res6.available, ['tasks.list', 'memory.save', 'credentials.get'], '(6) available keeps input order (credentials.get ok: vault true)');
  assertJson(res6.gated.map((g) => g.tool), ['gmail.send', 'browser.open_url', 'gcal.list'], '(6) gated in input order');
  assertJson(res6.gated.map((g) => g.missing), ['google.gmail', 'browser', 'google.calendar'], '(6) gated missing capabilities');
  assert(res6.gated.every((g) => typeof g.hint === 'string' && (g.hint as string).length > 0), '(6) each gated verdict carries a hint');
  assertEq(res6.note, 'Withheld 3 tools needing: Google Workspace, a browser provider.', '(6) note collapses google services + lists browser');
  // dedup preserves first occurrence order
  const dedupRes = gateToolNames(['gmail.send', 'gmail.send', 'tasks.list', 'tasks.list'], { google: false });
  assertJson(dedupRes.available, ['tasks.list'], '(6) dedup available');
  assertJson(dedupRes.gated.map((g) => g.tool), ['gmail.send'], '(6) dedup gated');
  // everything available when nothing is explicitly off
  const allOk = gateToolNames(candidates6, {});
  assertJson(allOk.gated, [], '(6) nothing gated on empty snapshot');
  assertEq(allOk.note, '', '(6) empty note when nothing gated');
  assertEq(allOk.available.length, 6, '(6) all candidates advertised on unknown snapshot');

  // -- (7) maxGated cap - overflow tools withheld from BOTH lists ---------------
  const snap7: ConnectivitySnapshot = { google: false };
  const cand7 = ['gmail.send', 'gcal.list', 'gsheets.read', 'gdocs.append'];
  const capped = gateToolNames(cand7, snap7, { maxGated: 2 });
  assertEq(capped.gated.length, 2, '(7) gated list capped at maxGated');
  assertJson(capped.available, [], '(7) overflow-gated tools are NOT advertised (never available)');
  assertEq(gateToolNames(cand7, snap7, { maxGated: 0 }).gated.length, 0, '(7) maxGated:0 -> empty gated list');
  assertEq(gateToolNames(cand7, snap7).gated.length, 4, '(7) default maxGated keeps all gated');

  // -- (8) summarizeGates - counts, labels, dedup, bounds ----------------------
  const gatedSet: ToolConnectivityVerdict[] = [
    { tool: 'gmail.send', status: 'gated', missing: 'google.gmail' },
    { tool: 'gcal.list', status: 'gated', missing: 'google.calendar' },
    { tool: 'wp.list_posts', status: 'gated', missing: 'wordpress' },
  ];
  assertEq(summarizeGates(gatedSet), 'Withheld 3 tools needing: Google Workspace, WordPress.', '(8) google services deduped to one label');
  assertEq(summarizeGates([{ tool: 'a', status: 'gated', missing: 'vault' }]), 'Withheld 1 tool needing: the vault.', '(8) singular "tool"');
  assertEq(summarizeGates([]), '', '(8) empty -> empty string');
  assertEq(summarizeGates([{ tool: 'x', status: 'available' }]), '', '(8) only gated verdicts counted');
  assertEq(summarizeGates([{ tool: 'x', status: 'gated', missing: 'eyJhbGciOiJIUzI1NiJ9.payload.sig' }]), 'Withheld 1 tool.', '(8) unknown/secret-shaped capability yields no label');
  assertEq(summarizeGates([{ tool: 'x', status: 'gated', missing: 'notion' }]), 'Withheld 1 tool needing: Notion.', '(8) clean provider token Title-cased');
  assertEq(summarizeGates([{ tool: 'x', status: 'gated', missing: 'provider_with_a_name_far_too_long_to_be_a_token' }]), 'Withheld 1 tool.', '(8) over-long capability token yields no label');
  // note stays bounded even with many distinct labels (p0..p59 -> P0..P59 overflow)
  const bigGated: ToolConnectivityVerdict[] = Array.from({ length: 60 }, (_, i) => ({
    tool: `t${i}`,
    status: 'gated' as const,
    missing: `p${i}`,
  }));
  assert(summarizeGates(bigGated).length <= MAX_NOTE_LEN, '(8) note clamped to MAX_NOTE_LEN', String(summarizeGates(bigGated).length));
  assert(summarizeGates(bigGated).startsWith('Withheld 60 tools needing:'), '(8) count is accurate before clamp');

  // -- (9) isToolConnectionGated convenience -----------------------------------
  assertEq(isToolConnectionGated('gmail.send', { google: false }), true, '(9) gated true');
  assertEq(isToolConnectionGated('gmail.send', { google: true }), false, '(9) available false');
  assertEq(isToolConnectionGated('tasks.list', { google: false }), false, '(9) unmatched false');
  assertEq(isToolConnectionGated(null, null), false, '(9) hostile -> false (fail open)');

  // -- (10) DEFAULT rules + exported consts ------------------------------------
  assertEq(DEFAULT_TOOL_PREREQ_RULES.length, 10, '(10) ten built-in rules');
  assert(DEFAULT_TOOL_PREREQ_RULES.every((r) => typeof r.match === 'string' && r.match.length > 0), '(10) every rule has a match');
  assert(DEFAULT_TOOL_PREREQ_RULES.every((r) => typeof r.capability === 'string' && r.capability.length > 0), '(10) every rule has a capability');
  assert(DEFAULT_TOOL_PREREQ_RULES.every((r) => typeof r.hint === 'string' && r.hint.length > 0), '(10) every rule has a hint');
  assert(DEFAULT_TOOL_PREREQ_RULES.some((r) => r.match === 'credentials.get' && r.capability === 'vault'), '(10) credentials.get to vault present');
  assert(DEFAULT_TOOL_PREREQ_RULES.some((r) => r.match === 'browser.fill_credential_field' && r.capability === 'vault'), '(10) browser.fill_credential_field to vault present');
  // frozen - mutation attempts are ignored (no throw in non-strict tsx eval)
  try {
    (DEFAULT_TOOL_PREREQ_RULES as ToolPrereqRule[]).push({ match: 'x.', capability: 'x', hint: 'x' });
  } catch {
    /* a frozen array may throw on push in strict mode - also fine */
  }
  assertEq(DEFAULT_TOOL_PREREQ_RULES.length, 10, '(10) DEFAULT_TOOL_PREREQ_RULES is frozen (length unchanged)');
  assertEq(MAX_CANDIDATES, 1000, '(10) MAX_CANDIDATES is 1000');
  assertEq(MAX_RULES_SCANNED, 200, '(10) MAX_RULES_SCANNED is 200');
  assertEq(MAX_TOOL_NAME_LEN, 200, '(10) MAX_TOOL_NAME_LEN is 200');
  assertEq(MAX_MATCH_LEN, 200, '(10) MAX_MATCH_LEN is 200');
  assertEq(MAX_CAP_LEN, 80, '(10) MAX_CAP_LEN is 80');
  assertEq(MAX_HINT_LEN, 200, '(10) MAX_HINT_LEN is 200');
  assertEq(MAX_NOTE_LEN, 240, '(10) MAX_NOTE_LEN is 240');

  // -- (11) determinism - identical inputs -> byte-identical output -------------
  const detSnap: ConnectivitySnapshot = { google: false, browser: false, desktopBridge: false, vault: false, wordpress: false };
  const detCand = ['gmail.send', 'gcal.list', 'browser.open_url', 'desktop.launch_app', 'wp.list_posts', 'credentials.get', 'browser.fill_credential_field'];
  const r1 = gateToolNames(detCand, detSnap);
  const r2 = gateToolNames(detCand, detSnap);
  assertEq(JSON.stringify(r1), JSON.stringify(r2), '(11) gateToolNames deterministic across runs');
  assertEq(JSON.stringify(classifyToolConnectivity('gmail.send', detSnap)), JSON.stringify(classifyToolConnectivity('gmail.send', detSnap)), '(11) classify deterministic');
  assertEq(summarizeGates(r1.gated), summarizeGates(r1.gated), '(11) summarizeGates deterministic');

  // -- (12) secret safety - note is subset of the fixed label vocabulary -------
  const secretNote = r1.note; // whole-snapshot-false note from (11)
  const ALLOWED_LABELS = ['Google Workspace', 'a browser provider', 'the desktop bridge', 'the vault', 'WordPress'];
  const body = secretNote.replace(/^Withheld \d+ tools? needing: /, '').replace(/\.$/, '');
  const items = body.length > 0 ? body.split(', ') : [];
  assert(items.length > 0, '(12) note has labels for the all-false snapshot', secretNote);
  assert(items.every((it) => ALLOWED_LABELS.includes(it)), '(12) every note label is from the fixed vocabulary', secretNote);
  assert(!/true|false|undefined|null|[{}[\]<>`]/.test(secretNote), '(12) note leaks no boolean/brace/fence chars', secretNote);
  // even with a snapshot whose values are secret-shaped strings, resolution
  // ignores them (only literal booleans count) -> nothing gated, empty note.
  const secretSnap = { google: 'eyJhbGciOiJIUzI1NiJ9.evil.sig', vault: 'Hunter2SuperSecret', integrations: { slack: 'AKIAABCDEFGHIJKLMNOP' } } as unknown;
  const secretRes = gateToolNames(['gmail.send', 'credentials.get', 'slack.send'], secretSnap, { extraRules: [slackRule] });
  assertJson(secretRes.gated, [], '(12) secret-shaped (non-boolean) snapshot values never gate');
  assertEq(secretRes.note, '', '(12) secret-shaped snapshot -> empty note (no leak)');
  assert(!secretRes.available.join(' ').includes('eyJ') && !secretRes.available.join(' ').includes('Hunter2'), '(12) no snapshot value echoed into available');

  // -- (13) tool-name cleaning + clamping --------------------------------------
  // backtick / angle brackets / control chars all collapse to spaces (a residual
  // single space between real chars is fine - the point is fence/control removal).
  const messyTool = classifyToolConnectivity('a b`c<d>e', {}).tool;
  assert(!/[`<>]/.test(messyTool), '(13) backtick + angle brackets stripped from tool name', JSON.stringify(messyTool));
  assert(![...messyTool].some((ch) => ch.charCodeAt(0) <= 0x1f || ch.charCodeAt(0) === 0x7f), '(13) control chars stripped from tool name', JSON.stringify(messyTool));
  // a space inside the family name breaks the prefix -> fail open (available)
  assertEq(classifyToolConnectivity('gm ail.send', { google: false }).status, 'available', '(13) broken family name -> available (fail open)');
  assertEq(classifyToolConnectivity('gmail.send', { google: false }).status, 'gated', '(13) a clean gmail.* name still matches the family prefix');
  const longName = 'gmail.' + 'x'.repeat(2000);
  const longVerdict = classifyToolConnectivity(longName, { google: false });
  assert(longVerdict.tool.length <= MAX_TOOL_NAME_LEN, '(13) long tool name clamped to MAX_TOOL_NAME_LEN', String(longVerdict.tool.length));
  assertEq(longVerdict.status, 'gated', '(13) a long gmail.* name still matches the family prefix after clamp');
  assertEq(classifyToolConnectivity('', { google: false }).tool, '', '(13) empty tool name -> empty tool');
  assertEq(classifyToolConnectivity('   ', { google: false }).status, 'available', '(13) whitespace-only tool name -> available');

  // -- (14) bounds - candidate cap + rule-scan cap -----------------------------
  const many = Array.from({ length: 5000 }, (_, i) => `tool_${i}`);
  const manyRes = gateToolNames(many, { google: false });
  assert(manyRes.available.length <= MAX_CANDIDATES, '(14) candidate list capped at MAX_CANDIDATES', String(manyRes.available.length));
  assertEq(manyRes.available.length, MAX_CANDIDATES, '(14) exactly MAX_CANDIDATES unique candidates advertised');
  // 300 extra rules for the same tool family: bounded scan, still total, no throw.
  const manyRules: ToolPrereqRule[] = Array.from({ length: 300 }, (_, i) => ({ match: `nope${i}.`, capability: 'x', hint: 'h' }));
  manyRules.push({ match: 'zzz.', capability: 'zzz', hint: 'h' });
  const ruleRes = classifyToolConnectivity('nope5.go', { integrations: { x: false } }, { extraRules: manyRules });
  assert(ruleRes.status === 'gated' || ruleRes.status === 'available', '(14) huge extraRules list handled totally', ruleRes.status);

  // -- (15) HOSTILE INPUT - never throw, fail OPEN -----------------------------
  try {
    // 15a: junk tool names / snapshots
    const junk: unknown[] = [null, undefined, 42, NaN, Infinity, -0, true, {}, [], [1, 2, 3], () => 'x', Symbol('s'), 9n, 'nonsense.tool'];
    for (const t of junk) {
      for (const s of junk) {
        assert(totalOn(t, s), '(15a) total (no throw) on hostile tool x snapshot', `${String(typeof t)} x ${String(typeof s)}`);
      }
    }
    // 15b: hostile tool always resolves to a valid verdict (fail open)
    for (const t of junk) {
      const v = classifyToolConnectivity(t, { google: false, browser: false, vault: false });
      assert(v.status === 'available' || v.status === 'gated', '(15b) verdict status always valid');
      assert(typeof v.tool === 'string', '(15b) verdict tool always a string');
      assertEq(isToolConnectionGated(t, null), false, '(15b) hostile -> not gated (fail open)');
    }

    // 15c: cyclic snapshot - accessing normal fields must not loop/throw.
    const cyclic: Record<string, unknown> = { google: false };
    cyclic.self = cyclic;
    cyclic.integrations = cyclic; // integrations points back at itself
    assertEq(classifyToolConnectivity('gmail.send', cyclic).status, 'gated', '(15c) cyclic snapshot still reads a boolean field');
    assert(totalOn('wp.list_posts', cyclic), '(15c) cyclic snapshot total');

    // 15d: throwing getters on the snapshot -> treated as unknown -> available.
    const throwing: unknown = new Proxy(
      {},
      {
        get() {
          throw new Error('boom');
        },
      },
    );
    assertEq(classifyToolConnectivity('gmail.send', throwing).status, 'available', '(15d) throwing-getter snapshot -> unknown -> available');
    assertEq(isToolConnectionGated('browser.open_url', throwing), false, '(15d) throwing snapshot never gates');
    assert(totalOn('desktop.launch_app', throwing), '(15d) throwing snapshot total');
    const throwingNested = {
      google: true,
      get googleServices() {
        throw new Error('nested boom');
      },
    };
    assertEq(classifyToolConnectivity('gmail.send', throwingNested).status, 'available', '(15d) throwing nested service getter -> available');

    // 15e: garbage extraRules are ignored (never shadow / never crash).
    const badOpts = { extraRules: [null, 42, {}, { match: 123 }, { match: 'ok.' }, { match: 'x.', capability: 5 }, 'str', [], () => 1] } as unknown;
    const garbRes = gateToolNames(['gmail.send', 'x.go'], { google: false }, badOpts as never);
    assertEq(garbRes.gated.some((g) => g.tool === 'gmail.send'), true, '(15e) valid default rule still applies with garbage extraRules');
    assert(!garbRes.gated.some((g) => g.tool === 'x.go'), '(15e) garbage rule (no capability) never gates x.go');
    assert(totalOn('x.go', { google: false }), '(15e) garbage extraRules total');

    // 15f: huge candidate array of the SAME string -> deduped to one, bounded.
    const sameHuge = Array.from({ length: 20000 }, () => 'gmail.send');
    const sameRes = gateToolNames(sameHuge, { google: false });
    assertEq(sameRes.gated.length, 1, '(15f) 20k duplicate candidates dedupe to one gated verdict');
    assertJson(sameRes.available, [], '(15f) nothing available (the one tool is gated)');

    // 15g: control-char / huge / mixed candidate junk list.
    const junkCandidates = [null, 42, {}, 'gmail.send', 'gmail. send', 'x'.repeat(5000), '', '   ', 'tasks.list', () => 'x'];
    const jr: GateResult = gateToolNames(junkCandidates as unknown, { google: false });
    assert(Array.isArray(jr.available) && Array.isArray(jr.gated), '(15g) junk candidate list -> valid GateResult');
    assert(jr.gated.some((g) => g.tool === 'gmail.send'), '(15g) valid gmail.send extracted from junk list');
    assert(jr.available.includes('tasks.list'), '(15g) valid tasks.list extracted from junk list');
    assert(jr.available.every((n) => n.length <= MAX_TOOL_NAME_LEN), '(15g) every advertised name is clamped');

    // 15h: summarizeGates on hostile arrays.
    assertEq(summarizeGates(null), '', '(15h) summarizeGates(null) -> ""');
    assertEq(summarizeGates(42 as unknown), '', '(15h) summarizeGates(number) -> ""');
    assertEq(summarizeGates([null, 42, {}, 'x', () => 1] as unknown), '', '(15h) summarizeGates(junk array) -> "" (no gated verdicts)');
    assert(typeof summarizeGates([{ status: 'gated', missing: {} }, { status: 'gated' }] as unknown) === 'string', '(15h) summarizeGates total on odd verdicts');

    // 15i: __proto__ tricks never leak the prototype into a label or a gate.
    assertEq(summarizeGates([{ tool: 'x', status: 'gated', missing: '__proto__' }] as unknown), 'Withheld 1 tool.', '(15i) __proto__ capability yields no label (no prototype leak)');
    assertEq(classifyToolConnectivity('gmail.send', { google: false }, { extraRules: [{ match: 'gmail.', capability: '__proto__', hint: 'h' }] as ToolPrereqRule[] }).status, 'available', '(15i) __proto__ capability resolves unknown -> available');

    passes += 1; // reached the end of the hostile group without throwing
  } catch (e) {
    failures += 1;
    console.error(`FAIL: (15) hostile inputs threw: ${(e as Error)?.message}`);
  }

  if (failures > 0) {
    console.error(`\n${failures} failure(s), ${passes} passed`);
    process.exit(1);
  }
  console.log(`\nAll tool-connectivity-gate-core smoke cases passed (${passes} passed).`);
}

main();
