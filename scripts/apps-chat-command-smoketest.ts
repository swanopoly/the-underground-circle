/**
 * apps-chat-command-smoketest — guards the `/apps` window into app automation
 * (src/lib/appsChatCommand.ts):
 *
 *  1. Parse grammar: whole-token `/apps` only — `/appsx` falls through
 *     (null); bare `/apps` is the overview case; case-insensitive; padded
 *     multi-word names collapse; oversized lookups fail closed.
 *  2. Overview: bounded ≤1800, counts computed from APP_AUTOMATION_DOCS,
 *     every executable/partial app named with a lane phrase, group name
 *     lists present, usage hint at the end — and NO raw `desktop.` tool
 *     names (tool names belong in detail view).
 *  3. Detail cards: plain-words status + docPath for photoshop; blender's
 *     lane cites the real `desktop.cad_compile`; the injected probe's string
 *     is appended, while probe null / probe throw / absent deps all degrade
 *     to the same static-profile line (buildAppDetail NEVER throws).
 *     Reachability-aware quick fixes: probe summaries with chatCanFix +
 *     needs_launch/needs_focus produce a fix chip (FIRST in quick replies,
 *     bounds intact); bridge_offline/bridge_outdated add the restart-the-
 *     bridge fix line to the body with NO chip; legacy plain-string probe
 *     returns keep working ({text, status:'unknown', chatCanFix:false}).
 *  4. Unknown apps: honest miss + 3 closest suggestions via includes-scoring
 *     ("fotoshop" → photoshop) where every suggestion round-trips through
 *     resolveAppAutomationDoc (the Sketch alias trap).
 *  5. Quick replies: ≤4 each ≤64 chars — overview trio; status-appropriate
 *     next steps for executable/web/buildout/cloud details.
 *  6. buildAppsOverviewWithLive: the injected browserStatus dep appends a
 *     bounded "Browser surface: …" line under the overview; absent dep,
 *     null/whitespace returns, and throws all leave the base overview
 *     byte-identical (never throws); the sync buildAppsOverview stays
 *     untouched for compat.
 *
 * Pure module — no supabase, no react-native; probes are injected fakes.
 *
 * Run: npx tsx scripts/apps-chat-command-smoketest.ts
 */

import {
  APPS_REACHABILITY_FALLBACK_LINE,
  MAX_APPS_BROWSER_STATUS_LENGTH,
  MAX_APPS_DETAIL_LENGTH,
  MAX_APPS_OVERVIEW_LENGTH,
  MAX_APPS_QUERY_LENGTH,
  MAX_APPS_QUICK_REPLIES,
  MAX_APPS_QUICK_REPLY_LENGTH,
  buildAppDetail,
  buildAppsOverview,
  buildAppsOverviewWithLive,
  buildAppsQuickReplies,
  parseAppsCommand,
} from '../src/lib/appsChatCommand';
import {
  APP_AUTOMATION_DOCS,
  resolveAppAutomationDoc,
} from '../src/lib/appAutomationDocsIndex';

let failures = 0;
let passes = 0;
function pass(message: string): void {
  passes += 1;
  console.log('pass:', message);
}
function fail(message: string): void {
  failures += 1;
  console.error('FAIL:', message);
}
function assert(condition: unknown, message: string, detail?: string): void {
  if (condition) pass(message);
  else fail(`${message}${detail ? ` — ${detail}` : ''}`);
}
function assertEqual<T>(actual: T, expected: T, message: string): void {
  assert(
    actual === expected,
    message,
    `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
  );
}

async function main(): Promise<void> {
  // ─── (a) parse grammar ────────────────────────────────────────────────────
  assertEqual(parseAppsCommand('/appsx'), null, '(a) "/appsx" is not our token — null fall-through');
  assertEqual(parseAppsCommand('/appsx photoshop'), null, '(a) "/appsx photoshop" falls through');
  assertEqual(parseAppsCommand('/app'), null, '(a) "/app" falls through');
  assertEqual(parseAppsCommand('chatting about /apps'), null, '(a) non-command text falls through');
  assertEqual(parseAppsCommand(''), null, '(a) empty input falls through');

  {
    const parsed = parseAppsCommand('/apps');
    assert(parsed?.ok === true && parsed.appQuery === null, '(a) bare /apps → ok with null query (overview case)');
  }
  {
    const parsed = parseAppsCommand('  /apps   ');
    assert(parsed?.ok === true && parsed.appQuery === null, '(a) whitespace-padded bare /apps still the overview case');
  }
  {
    const parsed = parseAppsCommand('/APPS');
    assert(parsed?.ok === true && parsed.appQuery === null, '(a) /APPS is case-insensitive');
  }
  {
    const parsed = parseAppsCommand('/apps photoshop');
    assert(parsed?.ok === true, '(a) /apps photoshop parses ok');
    if (parsed?.ok) assertEqual(parsed.appQuery, 'photoshop', '(a) single-word query extracted');
  }
  {
    const parsed = parseAppsCommand('/apps  Affinity Designer ');
    assert(parsed?.ok === true, '(a) padded multi-word query parses ok');
    if (parsed?.ok) assertEqual(parsed.appQuery, 'Affinity Designer', '(a) multi-word query trimmed + joined');
  }
  {
    const parsed = parseAppsCommand('/Apps MATLAB / Simulink');
    assert(parsed?.ok === true && parsed.appQuery === 'MATLAB / Simulink', '(a) mixed-case command keeps the query verbatim');
  }
  {
    const parsed = parseAppsCommand(`/apps ${'x'.repeat(MAX_APPS_QUERY_LENGTH + 1)}`);
    assert(parsed !== null && parsed.ok === false, '(a) oversized query fails closed');
    if (parsed && parsed.ok === false) {
      assert(/too long/i.test(parsed.error), '(a) oversized-query error says why', parsed.error);
    }
  }

  // ─── (b) overview ─────────────────────────────────────────────────────────
  const overview = buildAppsOverview();
  assert(overview.length <= MAX_APPS_OVERVIEW_LENGTH,
    `(b) overview bounded ≤${MAX_APPS_OVERVIEW_LENGTH}`, `${overview.length} chars`);
  assert(!overview.includes('desktop.'), '(b) overview has no raw desktop.* tool names');

  const byStatus = (status: string) => APP_AUTOMATION_DOCS.filter((doc) => doc.status === status);
  assert(overview.includes(`${APP_AUTOMATION_DOCS.length} app profiles`), '(b) overview states the total profile count');
  assert(overview.includes(`${byStatus('executable').length} ready now`), '(b) overview counts executable apps');
  assert(overview.includes(`${byStatus('partial').length} partly automated`), '(b) overview counts partial apps');
  assert(overview.includes(`${byStatus('buildout_only').length} buildout-only`), '(b) overview counts buildout-only apps');
  assert(overview.includes(`${byStatus('web_only').length} web-only`), '(b) overview counts web-only apps');
  assert(overview.includes(`${byStatus('cloud_service').length} cloud services`), '(b) overview counts cloud services');

  {
    let allNamed = true;
    for (const doc of APP_AUTOMATION_DOCS) {
      if (!overview.includes(doc.appName)) { allNamed = false; fail(`(b) overview misses ${doc.appName}`); }
    }
    if (allNamed) pass('(b) overview names every registered app (lanes or group lists)');
  }
  assert(overview.includes('Adobe Photoshop — 12 script-backed tools'), '(b) Photoshop carries its one-phrase lane');
  assert(/Blender — [a-z]/.test(overview), '(b) Blender carries a one-phrase lane');
  assert(overview.includes('Try `/apps photoshop` for details and a live reachability check.'),
    '(b) overview ends with the usage hint');

  // ─── (c) detail: photoshop (no deps) ─────────────────────────────────────
  {
    const detail = await buildAppDetail('photoshop');
    assertEqual(detail.resolvedSlug, 'photoshop', '(c) photoshop query resolves to its slug');
    assert(detail.message.includes('Adobe Photoshop'), '(c) photoshop card names the app');
    assert(detail.message.includes('Executable — real script-backed tools ship today'),
      '(c) photoshop card uses the plain-words executable phrasing');
    assert(detail.message.includes('docs/apps/photoshop.md'), '(c) photoshop card cites the docPath');
    assert(detail.message.includes(APPS_REACHABILITY_FALLBACK_LINE),
      '(c) absent deps → static-profile reachability line');
    assert(detail.message.length <= MAX_APPS_DETAIL_LENGTH,
      `(c) photoshop card bounded ≤${MAX_APPS_DETAIL_LENGTH}`, `${detail.message.length} chars`);
  }

  // ─── (c2) detail: blender cites its real cad_compile lane ────────────────
  {
    const detail = await buildAppDetail('blender');
    assertEqual(detail.resolvedSlug, 'blender', '(c2) blender resolves');
    assert(detail.message.includes('cad_compile'), '(c2) blender lane cites desktop.cad_compile');
    assert(detail.message.includes('docs/apps/blender.md'), '(c2) blender card cites the docPath');
  }

  // ─── (c3) detail: every status renders plain words, bounded, doc-pathed ──
  {
    const statusProbes: Array<[string, string]> = [
      // illustrator moved partial → executable on 2026-07-29 (text tools wired
      // end to end), so the partial-status probe now uses inkscape.
      ['illustrator', 'Executable'],
      ['inkscape', 'Partially automated'],
      ['maya', 'Buildout-only'],
      ['figma', 'Web-only'],
      ['onshape', 'Cloud service'],
    ];
    for (const [query, phrase] of statusProbes) {
      const detail = await buildAppDetail(query);
      assert(detail.resolvedSlug !== null && detail.message.includes(phrase),
        `(c3) "${query}" card says "${phrase}"`, detail.message.slice(0, 120));
      assert(detail.message.includes('docs/apps/'), `(c3) "${query}" card cites a docPath`);
      assert(detail.message.length <= MAX_APPS_DETAIL_LENGTH, `(c3) "${query}" card bounded`);
    }
  }

  // ─── (c4) multi-word resolution through the parse result ─────────────────
  {
    const parsed = parseAppsCommand('/apps  Affinity Designer ');
    const detail = parsed?.ok && parsed.appQuery ? await buildAppDetail(parsed.appQuery) : null;
    assertEqual(detail?.resolvedSlug ?? null, 'affinity-designer', '(c4) "/apps  Affinity Designer " resolves end to end');
  }

  // ─── (d) injected probe behaviors ─────────────────────────────────────────
  {
    let probedAppName: string | null = null;
    const detail = await buildAppDetail('photoshop', {
      probeReachability: async (appName) => {
        probedAppName = appName;
        return 'Bridge online — Photoshop is running with 2 documents open.';
      },
    });
    assert(detail.message.includes('Bridge online — Photoshop is running with 2 documents open.'),
      '(d) probe result string is appended to the card');
    assert(detail.message.includes('Live reachability:'), '(d) probe result rides the Live reachability line');
    assert(!detail.message.includes(APPS_REACHABILITY_FALLBACK_LINE),
      '(d) successful probe replaces the static fallback line');
    assertEqual(probedAppName, 'Adobe Photoshop', '(d) probe is called with the registry appName');
  }
  {
    const detail = await buildAppDetail('photoshop', {
      probeReachability: async () => { throw new Error('bridge exploded'); },
    });
    assert(detail.message.includes(APPS_REACHABILITY_FALLBACK_LINE),
      '(d) probe throwing → graceful static-profile line (no throw)');
    assert(detail.message.includes('docs/apps/photoshop.md'), '(d) probe throwing still renders the full card');
  }
  {
    const detail = await buildAppDetail('freecad', { probeReachability: async () => null });
    assert(detail.message.includes(APPS_REACHABILITY_FALLBACK_LINE),
      '(d) probe returning null → graceful static-profile line');
  }
  {
    const detail = await buildAppDetail('openscad', { probeReachability: async () => '   ' });
    assert(detail.message.includes(APPS_REACHABILITY_FALLBACK_LINE),
      '(d) probe returning whitespace → treated as no live data');
  }
  {
    const detail = await buildAppDetail('indesign', {
      probeReachability: async () => 'x'.repeat(5_000),
    });
    assert(detail.message.length <= MAX_APPS_DETAIL_LENGTH,
      '(d) oversized probe output is clamped into the card bound', `${detail.message.length} chars`);
  }

  // ─── (d2) reachability-aware quick fixes ──────────────────────────────────
  {
    // needs_launch + chatCanFix → "Open … for me" chip, FIRST in replies.
    const detail = await buildAppDetail('photoshop', {
      probeReachability: async () => ({
        text: 'Adobe Photoshop is installed but not running yet.',
        status: 'needs_launch',
        chatCanFix: true,
        resolvedAppName: 'Adobe Photoshop 2026',
      }),
    });
    assertEqual(detail.fixChip, 'Open Adobe Photoshop 2026 for me',
      '(d2) needs_launch + chatCanFix → exact launch chip (probe resolvedAppName wins)');
    assert(detail.message.includes('Live reachability: Adobe Photoshop is installed but not running yet.'),
      '(d2) probe summary text still rides the Live reachability line');
    const replies = buildAppsQuickReplies(false, detail.resolvedSlug, detail.fixChip);
    assertEqual(replies[0], 'Open Adobe Photoshop 2026 for me', '(d2) fix chip goes FIRST in quick replies');
    assert(replies.length <= MAX_APPS_QUICK_REPLIES, `(d2) replies with chip stay ≤${MAX_APPS_QUICK_REPLIES}`);
    assert(replies.includes('/apps'), '(d2) the way back to the overview survives the chip');
  }
  {
    // needs_focus → "Bring … to the front"; no resolvedAppName → registry appName.
    const indesignName = APP_AUTOMATION_DOCS.find((doc) => doc.slug === 'indesign')?.appName ?? '';
    const detail = await buildAppDetail('indesign', {
      probeReachability: async () => ({
        text: 'Running, but another app is in front.',
        status: 'needs_focus',
        chatCanFix: true,
      }),
    });
    assertEqual(detail.fixChip, `Bring ${indesignName} to the front`,
      '(d2) needs_focus → focus chip falling back to the registry appName');
  }
  {
    // bridge_outdated → restart fix line in the body, NO chip.
    const detail = await buildAppDetail('photoshop', {
      probeReachability: async () => ({
        text: "Chat can't fully reach Adobe Photoshop yet — the desktop bridge is running an older build.",
        status: 'bridge_outdated',
        chatCanFix: false,
      }),
    });
    assert(detail.message.includes('Fix: restart the bridge with npm run bridge, then run /apps photoshop again.'),
      '(d2) bridge_outdated adds the restart+recheck fix line to the body', detail.message);
    assertEqual(detail.fixChip, null, '(d2) bridge_outdated is terminal work — no chip');
    assert(detail.message.length <= MAX_APPS_DETAIL_LENGTH,
      '(d2) card with the fix line stays bounded', `${detail.message.length} chars`);
  }
  {
    // bridge_offline → the same fix line, slug substituted for the app.
    const detail = await buildAppDetail('freecad', {
      probeReachability: async () => ({
        text: "Chat can't reach FreeCAD yet — the desktop bridge is offline.",
        status: 'bridge_offline',
        chatCanFix: false,
      }),
    });
    assert(detail.message.includes('Fix: restart the bridge with npm run bridge, then run /apps freecad again.'),
      '(d2) bridge_offline gets the fix line with the resolved slug');
    assertEqual(detail.fixChip, null, '(d2) bridge_offline → no chip');
  }
  {
    // Backward compat: plain-string probe return still renders, no chip.
    const detail = await buildAppDetail('photoshop', {
      probeReachability: async () => 'Bridge online — Photoshop is running.',
    });
    assert(detail.message.includes('Live reachability: Bridge online — Photoshop is running.'),
      '(d2) legacy string return still rides the reachability line');
    assertEqual(detail.fixChip, null, '(d2) legacy string return implies unknown status → no chip');
    assert(!detail.message.includes('Fix: restart the bridge'),
      '(d2) legacy string return never triggers the bridge fix line');
  }
  {
    // chatCanFix false → no chip even for a launchable state.
    const detail = await buildAppDetail('photoshop', {
      probeReachability: async () => ({ text: 'Not running.', status: 'needs_launch', chatCanFix: false }),
    });
    assertEqual(detail.fixChip, null, '(d2) chatCanFix:false → no chip even when launchable');
  }
  {
    // Chip length bound: oversized resolved names clamp at the source AND in replies.
    const detail = await buildAppDetail('photoshop', {
      probeReachability: async () => ({
        text: 'Not running.',
        status: 'needs_launch',
        chatCanFix: true,
        resolvedAppName: 'X'.repeat(200),
      }),
    });
    assert((detail.fixChip || '').length <= MAX_APPS_QUICK_REPLY_LENGTH,
      `(d2) oversized chip is clamped ≤${MAX_APPS_QUICK_REPLY_LENGTH} at the source`, detail.fixChip || '');
    const replies = buildAppsQuickReplies(false, 'photoshop', detail.fixChip);
    assert(replies.every((reply) => reply.length <= MAX_APPS_QUICK_REPLY_LENGTH),
      `(d2) chip obeys the ≤${MAX_APPS_QUICK_REPLY_LENGTH}-char reply bound`);
    assert(replies.length <= MAX_APPS_QUICK_REPLIES, '(d2) chip + detail replies stay within the reply cap');
  }
  {
    // Chip on top of the overview trio still clamps to ≤4 total.
    const replies = buildAppsQuickReplies(true, null, 'Open Adobe Photoshop for me');
    assertEqual(replies[0], 'Open Adobe Photoshop for me', '(d2) chip is first even ahead of the overview trio');
    assert(replies.length <= MAX_APPS_QUICK_REPLIES, `(d2) trio + chip clamps to ≤${MAX_APPS_QUICK_REPLIES}`);
  }
  {
    // No chip param → behavior unchanged (regression guard for the old arity).
    const replies = buildAppsQuickReplies(false, 'photoshop');
    assertEqual(replies[0], 'Remove the background from my open Photoshop file',
      '(d2) omitting fixChip keeps the existing first reply');
  }
  {
    // Miss/empty cards carry no chip.
    const miss = await buildAppDetail('fotoshop');
    assertEqual(miss.fixChip, null, '(d2) miss card has no fix chip');
    const empty = await buildAppDetail('');
    assertEqual(empty.fixChip, null, '(d2) empty query has no fix chip');
  }

  // ─── (e) unknown app → honest miss + closest suggestions ─────────────────
  {
    const detail = await buildAppDetail('fotoshop');
    assertEqual(detail.resolvedSlug, null, '(e) "fotoshop" resolves nothing');
    assert(/no automation profile matches/i.test(detail.message), '(e) miss message is honest');
    assert(/photoshop/i.test(detail.message), '(e) "fotoshop" suggests photoshop');
    assert(detail.message.includes('`/apps`'), '(e) miss message points back to /apps');
    const suggested = detail.message.match(/`\/apps ([^`]+)`/g) || [];
    assert(suggested.length >= 3, `(e) miss offers 3 suggestions (got ${suggested.length})`);
    let allResolve = true;
    for (const raw of suggested) {
      const query = raw.replace(/`\/apps /, '').replace(/`$/, '');
      if (!resolveAppAutomationDoc(query)) { allResolve = false; fail(`(e) suggestion does not resolve: ${raw}`); }
    }
    if (allResolve) pass('(e) every suggestion round-trips through resolveAppAutomationDoc');
  }
  {
    // The Sketch trap: "sketch" alone resolves nothing in the index, so the
    // suggestion for it must use a resolvable query (e.g. "sketch app").
    const detail = await buildAppDetail('sketch');
    assertEqual(detail.resolvedSlug, null, '(e) bare "sketch" is honestly unresolved');
    const suggested = detail.message.match(/`\/apps ([^`]+)`/g) || [];
    let allResolve = suggested.length > 0;
    for (const raw of suggested) {
      const query = raw.replace(/`\/apps /, '').replace(/`$/, '');
      if (!resolveAppAutomationDoc(query)) allResolve = false;
    }
    assert(allResolve, '(e) "sketch" suggestions are all resolvable (alias fallback works)', detail.message);
  }

  // ─── (f) quick replies ────────────────────────────────────────────────────
  {
    const replies = buildAppsQuickReplies(true);
    assert(replies.length <= MAX_APPS_QUICK_REPLIES, `(f) overview replies ≤${MAX_APPS_QUICK_REPLIES}`);
    assertEqual(JSON.stringify(replies), JSON.stringify(['/apps photoshop', '/apps freecad', '/apps figma']),
      '(f) overview replies are the representative trio');
  }
  {
    const replies = buildAppsQuickReplies(false, 'photoshop');
    assert(replies.includes('Remove the background from my open Photoshop file'),
      '(f) photoshop detail suggests a realistic executable task');
    assert(replies.includes('/apps'), '(f) detail replies include the way back to the overview');
  }
  {
    const replies = buildAppsQuickReplies(false, 'figma');
    assert(replies.some((reply) => /browser/i.test(reply)), '(f) web-only detail suggests the browser phrasing', replies.join(' | '));
  }
  {
    const replies = buildAppsQuickReplies(false, 'maya');
    assert(replies.some((reply) => /build/i.test(reply) && /adapter/i.test(reply)),
      '(f) buildout-only detail suggests building the adapter', replies.join(' | '));
  }
  {
    const replies = buildAppsQuickReplies(false, 'firefly-services');
    assert(replies.some((reply) => /connect/i.test(reply) && /marketplace/i.test(reply)),
      '(f) cloud-service detail suggests connecting in Marketplace', replies.join(' | '));
  }
  {
    const replies = buildAppsQuickReplies(false, null);
    assert(replies.length > 0 && replies.length <= MAX_APPS_QUICK_REPLIES,
      '(f) unresolved detail (miss) still gets bounded replies');
  }
  {
    // Bounds hold for EVERY registered slug in both modes.
    let allBounded = true;
    for (const doc of APP_AUTOMATION_DOCS) {
      const replies = buildAppsQuickReplies(false, doc.slug);
      if (replies.length > MAX_APPS_QUICK_REPLIES) { allBounded = false; fail(`(f) too many replies for ${doc.slug}`); }
      for (const reply of replies) {
        if (reply.length > MAX_APPS_QUICK_REPLY_LENGTH) {
          allBounded = false;
          fail(`(f) reply >${MAX_APPS_QUICK_REPLY_LENGTH} chars for ${doc.slug}: ${reply}`);
        }
      }
    }
    if (allBounded) pass(`(f) every slug's detail replies stay ≤${MAX_APPS_QUICK_REPLIES} × ≤${MAX_APPS_QUICK_REPLY_LENGTH} chars`);
  }

  // ─── (g) never throws on garbage ──────────────────────────────────────────
  {
    const garbage = ['%%%###@@@', '   ', ' ', '/apps', 'ﬀ🙃'.repeat(20), 'a'.repeat(500)];
    let survived = true;
    for (const input of garbage) {
      try {
        const detail = await buildAppDetail(input);
        if (typeof detail.message !== 'string' || detail.message.length === 0) {
          survived = false;
          fail(`(g) garbage "${input.slice(0, 20)}" produced an empty message`);
        }
        if (detail.message.length > MAX_APPS_DETAIL_LENGTH) {
          survived = false;
          fail(`(g) garbage "${input.slice(0, 20)}" broke the detail bound`);
        }
      } catch (error) {
        survived = false;
        fail(`(g) buildAppDetail threw on "${input.slice(0, 20)}": ${String(error)}`);
      }
      try {
        parseAppsCommand(input);
      } catch (error) {
        survived = false;
        fail(`(g) parseAppsCommand threw on "${input.slice(0, 20)}": ${String(error)}`);
      }
    }
    if (survived) pass('(g) parse + detail never throw on garbage and stay bounded');
  }
  {
    const detail = await buildAppDetail('');
    assertEqual(detail.resolvedSlug, null, '(g) empty query resolves nothing');
    assert(/\/apps/.test(detail.message), '(g) empty query answer points at /apps usage');
  }

  // ─── (h) buildAppsOverviewWithLive: browser-surface status line ───────────
  {
    const base = buildAppsOverview();
    assertEqual(await buildAppsOverviewWithLive(), base,
      '(h) no deps → base overview byte-identical');
    assertEqual(await buildAppsOverviewWithLive({}), base,
      '(h) deps without browserStatus → base overview byte-identical');
  }
  {
    const base = buildAppsOverview();
    const withLive = await buildAppsOverviewWithLive({
      browserStatus: async () => '1 Browserbase session active — checkout task running.',
    });
    assert(withLive.startsWith(base), '(h) live line APPENDS — the base overview is untouched above it');
    assert(withLive.includes('\n\nBrowser surface: 1 Browserbase session active — checkout task running.'),
      '(h) dep line rides the Browser surface footer', withLive.slice(-160));
    assert(withLive.length <= MAX_APPS_OVERVIEW_LENGTH + '\n\nBrowser surface: '.length + MAX_APPS_BROWSER_STATUS_LENGTH,
      '(h) combined output stays within the documented bound', `${withLive.length} chars`);
  }
  {
    const base = buildAppsOverview();
    assertEqual(await buildAppsOverviewWithLive({ browserStatus: async () => null }), base,
      '(h) dep returning null → base overview unchanged, no footer');
    assertEqual(await buildAppsOverviewWithLive({ browserStatus: async () => '   ' }), base,
      '(h) dep returning whitespace → base overview unchanged');
    assertEqual(await buildAppsOverviewWithLive({
      browserStatus: async () => { throw new Error('browser runtime exploded'); },
    }), base, '(h) dep throwing → base overview unchanged (never throws)');
    assert(!(await buildAppsOverviewWithLive({ browserStatus: async () => null })).includes('Browser surface:'),
      '(h) no line → no "Browser surface:" label at all');
  }
  {
    const withLive = await buildAppsOverviewWithLive({
      browserStatus: async () => `  2 sessions:\n  one on\tstripe.com  \n and one idle ${'x'.repeat(500)}`,
    });
    const footer = withLive.split('\n\nBrowser surface: ')[1] ?? '';
    assert(footer.length > 0 && !footer.includes('\n'),
      '(h) multi-line status collapses to a single footer line');
    assert(footer.length <= MAX_APPS_BROWSER_STATUS_LENGTH,
      `(h) oversized status clamps to ≤${MAX_APPS_BROWSER_STATUS_LENGTH} chars`, `${footer.length} chars`);
    assert(footer.includes('2 sessions: one on stripe.com'),
      '(h) collapsed status keeps the leading words readable', footer.slice(0, 60));
  }
  {
    const before = buildAppsOverview();
    await buildAppsOverviewWithLive({ browserStatus: async () => 'line' });
    assertEqual(buildAppsOverview(), before,
      '(h) compat guard: sync buildAppsOverview output unaffected by the live variant');
  }

  if (failures > 0) {
    console.error(`\n${failures} failure(s), ${passes} passed`);
    process.exit(1);
  }
  console.log(`\nAll apps-chat-command smoke cases passed (${passes} passed).`);
}

main().catch((error) => {
  console.error('FATAL: smoke crashed —', error);
  process.exit(1);
});
