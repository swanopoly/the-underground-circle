/**
 * known-app-shortcuts-smoketest — pure lookup table + intent matcher
 * from `src/lib/knownAppShortcuts.ts`. Guards against regressions in
 * the "open X app" fallback path.
 *
 * Run: npm run smoke:known-app-shortcuts
 */

import {
  KNOWN_APPS,
  matchKnownApp,
  normaliseAppIntentText,
  renderAppShortcut,
} from '../src/lib/knownAppShortcuts';

let failures = 0;
function fail(m: string) { failures += 1; console.error('FAIL:', m); }
function pass(m: string) { console.log('pass:', m); }
function assert(cond: unknown, name: string, detail?: string) {
  if (cond) pass(name); else fail(`${name}${detail ? ' — ' + detail : ''}`);
}

// ─── Registry sanity ──────────────────────────────────────────────────
assert(KNOWN_APPS.length >= 80, `registry has ≥80 apps (got ${KNOWN_APPS.length})`);

// Built-in + third-party apps the user has installed — exercises
// common utterances against the matcher so we pin the most-likely
// misfires (the "open Notes" regression, the "app store" tokeniser
// bug, the Music/Spotify conflict).
{
  const names: Array<[string, string]> = [
    // Core Apple apps
    ['open notes', 'apple-notes'],
    ['open apple notes', 'apple-notes'],
    ['launch notes app', 'apple-notes'],
    ['open reminders', 'reminders'],
    ['open messages', 'messages'],
    ['open photos', 'photos'],
    ['open maps', 'maps'],
    ['open facetime', 'facetime'],
    ['open music', 'music'],
    ['open podcasts', 'podcasts'],
    ['open app store', 'app-store'],
    ['open find my', 'find-my'],
    ['open system settings', 'system-settings'],
    // Additional built-ins
    ['open contacts', 'contacts'],
    ['open weather', 'weather'],
    ['open stocks', 'stocks'],
    ['open books', 'books'],
    ['open clock', 'clock'],
    ['open shortcuts', 'shortcuts'],
    ['open freeform', 'freeform'],
    ['open passwords', 'passwords'],
    ['open voice memos', 'voice-memos'],
    ['open image capture', 'image-capture'],
    ['open photo booth', 'photo-booth'],
    ['open font book', 'font-book'],
    ['open quicktime', 'quicktime'],
    ['open dictionary', 'dictionary'],
    ['launch magnifier', 'magnifier'],
    ['open iphone mirroring', 'iphone-mirroring'],
    ['open disk utility', 'disk-utility'],
    ['open system information', 'system-info'],
    ['open time machine', 'time-machine'],
    // iWork
    ['open pages', 'pages'],
    ['open numbers', 'numbers'],
    ['open keynote', 'keynote'],
    ['open imovie', 'imovie'],
    ['open garageband', 'garageband'],
    // Third-party
    ['open obsidian', 'obsidian'],
    ['open chatgpt', 'chatgpt'],
    ['open docker', 'docker'],
    ['open comet', 'comet'],
    ['open evernote', 'evernote'],
    ['open onenote', 'onenote'],
    ['open copilot', 'copilot'],
    ['open ollama', 'ollama'],
    ['open unity', 'unity-hub'],
    // Google suite resolves to web fallback entries
    ['open google docs', 'google-docs'],
    ['open google sheets', 'google-sheets'],
    ['open google slides', 'google-slides'],
    ['open google drive', 'google-drive'],
    // Adobe
    ['open photoshop', 'adobe-photoshop'],
    ['open illustrator', 'adobe-illustrator'],
    ['open premiere', 'adobe-premiere'],
    ['open after effects', 'adobe-after-effects'],
    ['open indesign', 'adobe-indesign'],
    ['open acrobat', 'adobe-acrobat'],
  ];
  for (const [utterance, expectedId] of names) {
    const m = matchKnownApp(utterance);
    assert(m?.id === expectedId, `match: "${utterance}" → ${expectedId} (got ${m?.id})`);
  }
}
for (const app of KNOWN_APPS) {
  assert(typeof app.id === 'string' && app.id.length > 0, `app id non-empty: ${app.id}`);
  assert(typeof app.webUrl === 'string' && app.webUrl.startsWith('http'), `app ${app.id}: webUrl is http(s)`);
  assert(Array.isArray(app.aliases) && app.aliases.length > 0, `app ${app.id}: has ≥1 alias`);
}

// ─── normaliseAppIntentText ──────────────────────────────────────────
assert(
  normaliseAppIntentText('please open zoom app on my computer').includes('zoom'),
  'normalise: extracts "zoom" from noisy utterance',
);
assert(
  !normaliseAppIntentText('please open zoom app on my computer').includes('please'),
  'normalise: strips "please"',
);
assert(
  !normaliseAppIntentText('launch the slack application').includes('application'),
  'normalise: strips "application"',
);

// ─── matchKnownApp ───────────────────────────────────────────────────
{
  const m = matchKnownApp('I said open zoom app on my computer');
  assert(m?.id === 'zoom', `match: "open zoom app on my computer" → zoom (got ${m?.id})`);
}
{
  const m = matchKnownApp('please launch slack');
  assert(m?.id === 'slack', `match: "launch slack" → slack`);
}
{
  // Longer alias wins — "microsoft teams" should beat "teams" alone.
  const m = matchKnownApp('open microsoft teams');
  assert(m?.id === 'teams', `match: "microsoft teams" → teams`);
}
{
  const m = matchKnownApp('fire up discord');
  assert(m?.id === 'discord', 'match: "fire up discord"');
}
{
  const m = matchKnownApp('open notion please');
  assert(m?.id === 'notion', 'match: "open notion please"');
}
{
  const m = matchKnownApp('bring up figma');
  assert(m?.id === 'figma', 'match: "bring up figma"');
}
{
  const m = matchKnownApp('what is quantum gravity');
  assert(m === null, 'match: non-app query → null');
}
// New known apps (Phase 1b follow-up — make bridge path fire for dev utilities)
{
  const m = matchKnownApp('open terminal');
  assert(m?.id === 'terminal', `match: "open terminal" → terminal (got ${m?.id})`);
}
{
  const m = matchKnownApp('open iterm');
  assert(m?.id === 'iterm', 'match: "open iterm" → iterm');
}
{
  const m = matchKnownApp('open finder');
  assert(m?.id === 'finder', 'match: "open finder" → finder');
}
{
  const m = matchKnownApp('open system settings');
  assert(m?.id === 'system-settings', 'match: "open system settings" → system-settings');
}
{
  const m = matchKnownApp('open calculator');
  assert(m?.id === 'calculator', 'match: "open calculator" → calculator');
}
{
  // Claude Code → Terminal alias (longest-alias-wins picks "claude code")
  const m = matchKnownApp('open claude code');
  assert(m?.id === 'terminal-claude', `match: "open claude code" → terminal-claude (got ${m?.id})`);
  assert(m?.displayName === 'Terminal', 'match: claude code resolves to Terminal display name');
}
{
  const m = matchKnownApp('open my terminal and launch claude code');
  // "claude code" (11 chars) wins over "terminal" (8 chars) — good because
  // we want the auto-chain path, not the bare launch.
  assert(m?.id === 'terminal-claude', 'match: multi-phrase "terminal and claude code" → terminal-claude');
}
{
  const m = matchKnownApp('');
  assert(m === null, 'match: empty string → null');
}

// ─── renderAppShortcut ───────────────────────────────────────────────
{
  const zoom = KNOWN_APPS.find((a) => a.id === 'zoom')!;
  const out = renderAppShortcut(zoom, { platform: 'mac' });
  assert(out.osUrl === 'zoommtg://', 'render: zoom osUrl on mac = zoommtg://');
  assert(out.webUrl === 'https://zoom.us', 'render: zoom webUrl');
  assert(out.keyboardHint?.includes('Cmd+Space'), 'render: zoom mac keyboard hint');
  assert(out.markdown.includes('zoommtg://'), 'render: markdown links to osUrl');
  assert(out.markdown.includes('https://zoom.us'), 'render: markdown links to web fallback');
}
{
  const mail = KNOWN_APPS.find((a) => a.id === 'mail')!;
  const onMac = renderAppShortcut(mail, { platform: 'mac' });
  const onWin = renderAppShortcut(mail, { platform: 'windows' });
  assert(onMac.osUrl === 'message:', 'render: mail mac osUrl (per-platform override)');
  assert(onWin.osUrl === 'mailto:', 'render: mail windows osUrl');
}
{
  const chrome = KNOWN_APPS.find((a) => a.id === 'chrome')!;
  const onLinux = renderAppShortcut(chrome, { platform: 'linux' });
  assert(onLinux.osUrl === null, 'render: chrome has no linux scheme → osUrl null');
  assert(onLinux.markdown.includes('https://www.google.com'), 'render: linux still shows web fallback');
}

if (failures > 0) {
  console.error(`\n${failures} known-app-shortcuts smoke-test failure(s)`);
  process.exit(1);
}
console.log('\nAll known-app-shortcuts smoke cases passed.');
