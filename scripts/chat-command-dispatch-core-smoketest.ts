// Smoke test for src/lib/chatCommandDispatchCore.ts
//
// Runs under tsx (no react-native / supabase / deno). Grounds against the REAL
// CHAT_COMMAND_REGISTRY (chatCommandRegistry.ts is import-free, so it loads
// cleanly here) plus synthetic registries for the specificity + hostile cases.
//
// Run: npx tsx scripts/chat-command-dispatch-core-smoketest.ts

import {
  matchChatCommand,
  buildCommandDispatchTable,
  type CommandMatch,
} from '../src/lib/chatCommandDispatchCore';
import { CHAT_COMMAND_REGISTRY } from '../src/lib/chatCommandRegistry';

let passes = 0;
let failures = 0;
function assert(c: boolean, m: string, e?: string) {
  if (c) passes++;
  else {
    failures++;
    console.error('FAIL: ' + m + (e ? ' :: ' + e : ''));
  }
}
function assertEq(a: any, b: any, m: string) {
  assert(a === b, m, 'got ' + JSON.stringify(a) + ' want ' + JSON.stringify(b));
}
// Safe label for hostile values whose own toString() may throw.
function label(v: unknown): string {
  try { return String(v).slice(0, 24); } catch { return '<unstringable>'; }
}

const REG = CHAT_COMMAND_REGISTRY;

function match(input: unknown): CommandMatch {
  return matchChatCommand(input, REG);
}

function main() {
  // ── Group 1: basic slash matches against the real registry ───────────────
  {
    const m = match('/context max');
    assert(m.matched, '1: /context max matched');
    assertEq(m.commandId, 'context', '1: /context max → id');
    assertEq(m.routeId, 'help', '1: /context max → routeId (context routes to help)');
    assertEq(m.argsText, 'max', '1: /context max → argsText');
    assertEq(m.command, '/context', '1: /context max → canonical command');

    assertEq(match('/help').commandId, 'help', '1: /help id');
    assertEq(match('/summary').commandId, 'summary', '1: /summary id');
    assertEq(match('/summary').routeId, 'summary', '1: /summary routeId');
    assertEq(match('/gh').commandId, 'gh', '1: bare /gh id');
    assertEq(match('/vault').commandId, 'vault', '1: bare /vault id');
    assertEq(match('/search x').routeId, 'search', '1: /search routeId');
  }

  // ── Group 2: argsText extraction + original-case preservation ────────────
  {
    assertEq(match('/context max').argsText, 'max', '2: simple arg');
    assertEq(match('/remember buy milk').argsText, 'buy milk', '2: multi-word arg');
    assertEq(match('/wiki solar').argsText, 'solar', '2: /wiki arg');
    const cased = match('/Context MAX');
    assert(cased.matched, '2: mixed-case command matched');
    assertEq(cased.commandId, 'context', '2: mixed-case → id');
    assertEq(cased.argsText, 'MAX', '2: argsText preserves original case');
    assertEq(match('/gh cat src/App.tsx').argsText, 'src/App.tsx', '2: path arg preserved');
  }

  // ── Group 3: bare command → matched with empty args ──────────────────────
  {
    for (const cmd of ['/context', '/mission', '/gh', '/vault', '/help', '/room']) {
      const m = match(cmd);
      assert(m.matched, '3: bare ' + cmd + ' matched');
      assertEq(m.argsText, '', '3: bare ' + cmd + ' empty args');
    }
    assertEq(match('/context').commandId, 'context', '3: bare /context id');
  }

  // ── Group 4: longest-match / subcommand specificity ──────────────────────
  {
    // '/hf help' (a full command) beats its own '/hf' alias.
    const hfHelp = match('/hf help');
    assertEq(hfHelp.commandId, 'hf-help', '4: /hf help → hf-help');
    assertEq(hfHelp.argsText, '', '4: /hf help → empty args (full command, not /hf + "help")');
    assertEq(hfHelp.command, '/hf help', '4: /hf help → canonical /hf help');

    // '/hf' alone → hf-help via alias, empty args.
    const hf = match('/hf');
    assertEq(hf.commandId, 'hf-help', '4: /hf alias → hf-help');
    assertEq(hf.argsText, '', '4: /hf → empty args');

    // '/hf status' → falls back to the '/hf' alias with "status" as args.
    const hfStatus = match('/hf status');
    assertEq(hfStatus.commandId, 'hf-help', '4: /hf status → hf-help');
    assertEq(hfStatus.argsText, 'status', '4: /hf status → args "status"');

    // '/mission status' resolves to the dedicated mission-status definition.
    const missionStatus = match('/mission status');
    assertEq(missionStatus.commandId, 'mission-status', '4: /mission status → mission-status');
    assertEq(missionStatus.argsText, '', '4: /mission status → empty args');

    // '/mission create Foo' → mission-create with the title as args.
    const missionCreate = match('/mission create Foo');
    assertEq(missionCreate.commandId, 'mission-create', '4: /mission create → mission-create');
    assertEq(missionCreate.argsText, 'Foo', '4: /mission create → args "Foo"');

    // '/mission' alone → mission.
    assertEq(match('/mission').commandId, 'mission', '4: bare /mission → mission');

    // GitHub subcommands.
    assertEq(match('/gh status').commandId, 'gh-status', '4: /gh status → gh-status');
    assertEq(match('/gh diff a b').commandId, 'gh-diff', '4: /gh diff → gh-diff');
    assertEq(match('/gh diff a b').argsText, 'a b', '4: /gh diff args');
    assertEq(match('/gh xyz').commandId, 'gh', '4: unknown gh subcommand → gh');
    assertEq(match('/gh xyz').argsText, 'xyz', '4: /gh xyz args');

    // Room + memory-bank + vault subcommands.
    assertEq(match('/room list').commandId, 'room-list', '4: /room list → room-list');
    assertEq(match('/room ls').commandId, 'room-ls', '4: /room ls → room-ls');
    const mbUpdate = match('/memory-bank update brief hello');
    assertEq(mbUpdate.commandId, 'memory-bank-update', '4: /memory-bank update → memory-bank-update');
    assertEq(mbUpdate.argsText, 'brief hello', '4: /memory-bank update args');
    assertEq(match('/memory-bank').commandId, 'memory-bank', '4: bare /memory-bank');
    assertEq(match('/vault list').commandId, 'vault-list', '4: /vault list → vault-list');
    assertEq(match('/review latest').commandId, 'review', '4: /review latest → review');
    assertEq(match('/review latest').argsText, 'latest', '4: /review args');
  }

  // ── Group 5: alias resolution ────────────────────────────────────────────
  {
    assertEq(match('/commands').commandId, 'commands', '5: /commands is its own canonical def');
    assertEq(match('/status').commandId, 'summary', '5: /status alias → summary');
    assertEq(match('/mb').commandId, 'memory-bank', '5: /mb alias → memory-bank');
    assertEq(match('/build page here').commandId, 'build-page', '5: /build alias → build-page');
    assertEq(match('/build page here').argsText, 'page here', '5: /build alias args');
    assertEq(match('/make a thing').commandId, 'create', '5: /make alias → create');
    assertEq(match('/best-of-n a,b task').commandId, 'bestof', '5: /best-of-n alias → bestof');
    assertEq(match('/vault ls').commandId, 'vault-list', '5: /vault ls alias → vault-list');
    assertEq(match('/vault search stripe').commandId, 'vault-find', '5: /vault search alias → vault-find');
    assertEq(match('/vault search stripe').argsText, 'stripe', '5: /vault search args');
    assertEq(match('/memory').commandId, 'memories', '5: /memory alias → memories');
  }

  // ── Group 6: typos / near-misses → no match ──────────────────────────────
  {
    for (const bad of ['/contxt', '/xyz', '/helppp', '/ghh', '/missio', '/con', '/vaul']) {
      assertEq(match(bad).matched, false, '6: typo ' + bad + ' → no match');
      assertEq(match(bad).commandId, undefined, '6: typo ' + bad + ' → no id');
    }
    // Word-boundary: '/ghost' must NOT match '/gh' (space required).
    assertEq(match('/ghost').matched, false, '6: /ghost does not match /gh');
    assertEq(match('/contextual').matched, false, '6: /contextual does not match /context');
  }

  // ── Group 7: non-slash input → matched false ─────────────────────────────
  {
    for (const s of ['hello', 'context max', 'help me', 'ask /context please', 'summarize this']) {
      assertEq(match(s).matched, false, '7: non-slash "' + s + '" → false');
    }
    assertEq(match('').matched, false, '7: empty → false');
    assertEq(match('   ').matched, false, '7: whitespace → false');
    assertEq(match('/').matched, false, '7: lone slash → false');
    assertEq(match('/ ').matched, false, '7: slash+space → false');
  }

  // ── Group 8: whitespace normalization ────────────────────────────────────
  {
    const padded = match('  /context max  ');
    assert(padded.matched, '8: leading/trailing space matched');
    assertEq(padded.commandId, 'context', '8: padded → id');
    assertEq(padded.argsText, 'max', '8: padded → trimmed args');
    assertEq(match('/context   ').argsText, '', '8: trailing spaces → empty args');
    // A single space separates command from args (mirrors ChatTab's literal
    // `startsWith('/x ')`), so multiple spaces fall back to the PARENT command
    // with the subcommand carried as args — the parent handler re-parses it.
    const multiSpace = match('/mission    status');
    assertEq(multiSpace.commandId, 'mission', '8: extra spaces → parent /mission');
    assertEq(multiSpace.argsText, 'status', '8: extra spaces → subcommand carried as args');
  }

  // ── Group 9: buildCommandDispatchTable — real registry ───────────────────
  {
    const table = buildCommandDispatchTable(REG);
    assert(Object.keys(table).length > 90, '9: table has >90 keys');
    assertEq(table['/context'].commandId, 'context', '9: table /context');
    assertEq(table['/context'].routeId, 'help', '9: table /context routeId');
    assertEq(table['/gh status'].commandId, 'gh-status', '9: table /gh status');
    assertEq(table['/mb'].commandId, 'memory-bank', '9: table alias /mb');
    assertEq(table['/vault ls'].commandId, 'vault-list', '9: table alias /vault ls');
    assertEq(table['/best-of-n'].commandId, 'bestof', '9: table alias /best-of-n');
    assertEq(table['/nope'], undefined, '9: table unknown → undefined');
    // Canonical-command-wins over another def's alias of the same string.
    assertEq(table['/help'].commandId, 'help', '9: /help → help (canonical, not commands alias)');
    assertEq(table['/commands'].commandId, 'commands', '9: /commands → commands (canonical)');
    assertEq(table['/proposals'].commandId, 'proposals', '9: /proposals → proposals (canonical)');
    assertEq(table['/vote'].commandId, 'vote', '9: /vote → vote (canonical, not proposals alias)');
    // Table stays consistent with the matcher on identity.
    assertEq(table['/context'].commandId, match('/context').commandId, '9: table/matcher agree /context');
    assertEq(table['/gh status'].commandId, match('/gh status').commandId, '9: table/matcher agree /gh status');
  }

  // ── Group 10: synthetic specificity ('/c' must not shadow '/context') ────
  {
    const synth = [
      { id: 'c', routeId: 'help', command: '/c' },
      { id: 'context', routeId: 'help', command: '/context' },
    ];
    assertEq(matchChatCommand('/context max', synth).commandId, 'context',
      '10: /c does not shadow /context');
    assertEq(matchChatCommand('/context max', synth).argsText, 'max', '10: /context args intact');
    assertEq(matchChatCommand('/c go', synth).commandId, 'c', '10: /c go → c');
    assertEq(matchChatCommand('/c go', synth).argsText, 'go', '10: /c go args');
    assertEq(matchChatCommand('/c', synth).commandId, 'c', '10: bare /c → c');

    // Canonical beats alias at equal length.
    const dup = [
      { id: 'alpha', routeId: 'help', command: '/x', aliases: ['/y'] },
      { id: 'beta', routeId: 'help', command: '/y', aliases: ['/x'] },
    ];
    assertEq(matchChatCommand('/x', dup).commandId, 'alpha', '10: /x → its canonical owner alpha');
    assertEq(matchChatCommand('/y', dup).commandId, 'beta', '10: /y → its canonical owner beta');
    const dupTable = buildCommandDispatchTable(dup);
    assertEq(dupTable['/x'].commandId, 'alpha', '10: table /x canonical wins');
    assertEq(dupTable['/y'].commandId, 'beta', '10: table /y canonical wins');
  }

  // ── Group 11: hostile / malformed input — must never throw ───────────────
  {
    const cyclic: any = { a: 1 };
    cyclic.self = cyclic;
    const hostileInputs: unknown[] = [
      null, undefined, 0, 1, NaN, true, false, {}, [], cyclic,
      Symbol('x') as any, () => '/context', /regex/, new Date(),
      { toString() { throw new Error('boom'); } },
      ['/context', 'max'],
    ];
    for (const bad of hostileInputs) {
      let out: CommandMatch | null = null;
      let threw = false;
      try { out = matchChatCommand(bad, REG); } catch { threw = true; }
      assert(!threw, '11: matchChatCommand no-throw on ' + label(bad));
      assert(out !== null && out.matched === false, '11: hostile input → matched false');
    }

    // Hostile registries.
    const hostileRegs: unknown[] = [
      null, undefined, 0, 'nope', {}, true,
      [null, undefined, 0, 'x', {}, []],
      [{ id: 'ok' }, { command: '/x' }, { id: 'y', command: 'no-slash' }],
      [{ id: 'z', command: '/z', aliases: 'not-array' }],
      [{ id: 'w', command: '/w', aliases: [null, 5, '/valid'] }],
      [{ id: 'p', command: '/' + 'x'.repeat(500), routeId: 'help' }], // over MAX_TOKEN
      cyclic,
    ];
    for (const reg of hostileRegs) {
      let threw = false;
      try {
        matchChatCommand('/x', reg);
        buildCommandDispatchTable(reg);
      } catch { threw = true; }
      assert(!threw, '11: no-throw on hostile registry ' + label(reg));
    }

    // Malformed entries are skipped, valid ones still resolve.
    const mixed = [
      null,
      { id: 'good', routeId: 'help', command: '/good', aliases: [null, '/g'] },
      { id: '', command: '/empty' }, // no id → skipped
      { id: 'noslash', command: 'x' }, // no slash → skipped
    ];
    assertEq(matchChatCommand('/good', mixed).commandId, 'good', '11: valid entry among junk resolves');
    assertEq(matchChatCommand('/g', mixed).commandId, 'good', '11: valid alias among junk resolves');
    assertEq(matchChatCommand('/empty', mixed).matched, false, '11: id-less entry skipped');
  }

  // ── Group 12: prototype-pollution safety in the dispatch table ───────────
  {
    const poison = [
      { id: 'proto', routeId: 'help', command: '/__proto__' },
      { id: 'ctor', routeId: 'help', command: '/constructor', aliases: ['/prototype'] },
      { id: 'norm', routeId: 'help', command: '/norm' },
    ];
    const t = buildCommandDispatchTable(poison);
    assertEq(t['/norm'].commandId, 'norm', '12: normal key still works alongside poison keys');
    assertEq(t['/__proto__'].commandId, 'proto', '12: /__proto__ stored as own key');
    // Object.prototype must be untouched.
    assertEq(({} as any).commandId, undefined, '12: Object.prototype not polluted');
    assertEq(matchChatCommand('/__proto__', poison).commandId, 'proto', '12: matcher handles /__proto__');
  }

  // ── Group 13: bounded huge input ─────────────────────────────────────────
  {
    const huge = '/summarize ' + 'x'.repeat(500_000);
    const m = match(huge);
    assert(m.matched, '13: huge /summarize matched');
    assertEq(m.commandId, 'summarize', '13: huge → summarize');
    assert((m.argsText || '').length <= 100_000, '13: argsText bounded (<=100k)');
    assert((m.argsText || '').startsWith('x'), '13: argsText content preserved');
    // A giant non-command paste is cheap + safe.
    assertEq(match('x'.repeat(1_000_000)).matched, false, '13: giant non-slash paste → false');
    assertEq(match('/' + 'z'.repeat(1_000_000)).matched, false, '13: giant slash non-command → false');
  }

  // ── Group 14: determinism + empty registry ───────────────────────────────
  {
    const a = match('/gh status');
    const b = match('/gh status');
    assertEq(JSON.stringify(a), JSON.stringify(b), '14: deterministic across calls');
    assertEq(matchChatCommand('/context', []).matched, false, '14: empty registry → no match');
    assertEq(Object.keys(buildCommandDispatchTable([])).length, 0, '14: empty registry → empty table');
  }

  if (failures > 0) {
    console.error('\n' + failures + ' fail');
    process.exit(1);
  }
  console.log('\nAll chat-command-dispatch-core smoke cases passed (' + passes + ' passed).');
}
main();
