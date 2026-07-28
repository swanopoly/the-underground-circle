/**
 * Smoke test for src/lib/chatCapabilityManifest.ts
 *
 * Pure / tsx-loadable: the module only `import type`s from the runtime, so this
 * loads under tsx/esbuild without pulling react-native.
 *
 * Run: npx tsx scripts/chat-capability-manifest-smoketest.ts
 */

import {
  APP_CAPABILITIES,
  buildCapabilityManifestPrompt,
  suggestCapabilitiesForMessage,
  isKnownCapabilityFamily,
  type AppCapability,
} from '../src/lib/chatCapabilityManifest';

let passed = 0;
let failed = 0;

function check(label: string, cond: boolean): void {
  if (cond) {
    passed += 1;
  } else {
    failed += 1;
    console.error(`  FAIL: ${label}`);
  }
}

function eqArr(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

// ── APP_CAPABILITIES shape ─────────────────────────────────────────────────
check('APP_CAPABILITIES is non-empty', Array.isArray(APP_CAPABILITIES) && APP_CAPABILITIES.length > 0);

const validApprovals = new Set<AppCapability['approval']>(['auto', 'ask']);
for (const cap of APP_CAPABILITIES) {
  const tag = cap?.family ? `[${cap.family}]` : '[?]';
  check(`${tag} has non-empty family`, typeof cap.family === 'string' && cap.family.trim().length > 0);
  check(`${tag} has non-empty title`, typeof cap.title === 'string' && cap.title.trim().length > 0);
  check(`${tag} has non-empty whenToUse`, typeof cap.whenToUse === 'string' && cap.whenToUse.trim().length > 5);
  check(`${tag} has valid approval`, validApprovals.has(cap.approval));
  check(`${tag} has >=1 exampleTools`, Array.isArray(cap.exampleTools) && cap.exampleTools.length >= 1);
  check(
    `${tag} exampleTools are non-empty strings`,
    cap.exampleTools.every((t) => typeof t === 'string' && t.trim().length > 0),
  );
}

// Families should be unique (one menu entry per family).
const families = APP_CAPABILITIES.map((c) => c.family);
check('capability families are unique', new Set(families).size === families.length);

// The heavy/long-tail families must be present in the menu.
for (const required of ['browser', 'desktop', 'wp', 'vault', 'team.deploy_agents']) {
  check(`menu includes "${required}"`, families.includes(required));
}

// At least one auto and one ask family (proves the posture field is exercised).
check('menu has at least one auto family', APP_CAPABILITIES.some((c) => c.approval === 'auto'));
check('menu has at least one ask family', APP_CAPABILITIES.some((c) => c.approval === 'ask'));

const browserCapability = APP_CAPABILITIES.find((cap) => cap.family === 'browser');
const browserDomIndex = browserCapability?.exampleTools.indexOf('browser.dom_snapshot') ?? -1;
const browserActionabilityIndex = browserCapability?.exampleTools.indexOf('browser.locator_actionability') ?? -1;
const browserMutationIndex = browserCapability?.exampleTools.indexOf('browser.set_toggle') ?? -1;
check(
  'browser examples order DOM -> locator actionability -> mutation',
  browserDomIndex >= 0
    && browserActionabilityIndex > browserDomIndex
    && browserMutationIndex > browserActionabilityIndex,
);
check(
  'browser capability explains advisory read-only evidence and the later mutation gate',
  !!browserCapability
    && /read-only advisory/i.test(browserCapability.whenToUse)
    && /later mutation still needs its own gate/i.test(browserCapability.whenToUse),
);

// Closed loop: every family that is ON the menu must be recognized by
// isKnownCapabilityFamily, so the menu and the known-family token set can never
// silently drift apart (a new capability without a token, or vice versa).
for (const cap of APP_CAPABILITIES) {
  check(`menu family is self-recognized: ${cap.family}`, isKnownCapabilityFamily(cap.family));
}

// ── buildCapabilityManifestPrompt ──────────────────────────────────────────
const prompt = buildCapabilityManifestPrompt();
check('prompt is a non-empty string', typeof prompt === 'string' && prompt.length > 0);
check('prompt mentions tools.search', prompt.includes('tools.search'));
check('prompt mentions browser', /browser/i.test(prompt));
check('prompt advertises browser.locator_actionability', prompt.includes('browser.locator_actionability'));
check('prompt mentions desktop', /desktop/i.test(prompt));
check('prompt mentions deploy_agents', prompt.includes('deploy_agents'));
check('prompt says stream a plain reply by default', /stream/i.test(prompt) && /plain/i.test(prompt));
check('prompt instructs quiet-in-chat', /quiet/i.test(prompt));
check('prompt mentions approval gating', /approval/i.test(prompt));
check('prompt mentions BlackSwan/OpenSwan collaboration', /blackswan/i.test(prompt) || /openswan/i.test(prompt));
check('prompt mentions never reveal secrets', /secret/i.test(prompt));

// Nothing on the menu is silently dropped: the full prompt names every
// capability title and tags each with its real family token.
for (const cap of APP_CAPABILITIES) {
  check(`full prompt lists capability title: ${cap.title}`, prompt.includes(cap.title));
  check(`full prompt tags family token: [${cap.family}]`, prompt.includes(`[${cap.family}]`));
}

// Surface label flows through.
const officePrompt = buildCapabilityManifestPrompt({ surface: 'office' });
check('surface label appears in prompt', officePrompt.includes('office'));

// enabledFamilies allowlist narrows the menu.
const narrowed = buildCapabilityManifestPrompt({ enabledFamilies: ['memory', 'research'] });
check('narrowed prompt still mentions tools.search', narrowed.includes('tools.search'));
check('narrowed prompt drops browser family line', !/\[browser\]/.test(narrowed));
check('narrowed prompt keeps memory family line', /\[memory\]/.test(narrowed));
check('narrowed prompt is shorter than full prompt', narrowed.length < prompt.length);

// Empty allowlist is treated as "no filter" (full menu), not "empty menu".
const emptyAllow = buildCapabilityManifestPrompt({ enabledFamilies: [] });
check('empty allowlist falls back to full menu', /\[browser\]/.test(emptyAllow));

// ── suggestCapabilitiesForMessage ──────────────────────────────────────────
check(
  'wordpress message -> ["wp"]',
  eqArr(suggestCapabilitiesForMessage('Please update the DI Slides on our WordPress site'), ['wp']),
);
check(
  'photoshop message -> ["desktop:design"]',
  suggestCapabilitiesForMessage('open the Photoshop file and run a generative fill')[0] === 'desktop:design',
);
check(
  'deploy message -> includes team.deploy_agents',
  suggestCapabilitiesForMessage('deploy 20 agents in parallel to crawl these pages').includes('team.deploy_agents'),
);
check(
  'browser message -> includes browser',
  suggestCapabilitiesForMessage('log in to the dashboard and click the export button').includes('browser'),
);
check(
  'memory message -> includes memory',
  suggestCapabilitiesForMessage('remember that our staging URL is internal-only').includes('memory'),
);
check(
  'github message -> includes github',
  suggestCapabilitiesForMessage('read the README from our github repo').includes('github'),
);
check(
  'vault message -> includes vault',
  suggestCapabilitiesForMessage('grant automation access to the 1Password credential').includes('vault'),
);

// Specificity: a Photoshop ask should rank the design family ahead of generic desktop.
const designHits = suggestCapabilitiesForMessage('edit this Photoshop file on my mac and take a screenshot');
check('design ranks before generic desktop', designHits.indexOf('desktop:design') < designHits.indexOf('desktop'));

// Empty / whitespace / non-string-ish input.
check('empty message -> []', eqArr(suggestCapabilitiesForMessage(''), []));
check('whitespace message -> []', eqArr(suggestCapabilitiesForMessage('   '), []));
check('garbage non-matching message -> []', eqArr(suggestCapabilitiesForMessage('asdf qwerty zzz'), []));
// @ts-expect-error — defensive: callers may pass undefined.
check('undefined message -> []', eqArr(suggestCapabilitiesForMessage(undefined), []));

// Suggestions are de-duplicated.
const multi = suggestCapabilitiesForMessage('use the browser to navigate and click a button on the browser page');
check('suggestions are de-duplicated', new Set(multi).size === multi.length);

// Every suggested family is a real menu family token (no orphan suggestions).
const allSuggestionFamilies = new Set<string>();
for (const m of [
  'wordpress', 'photoshop', 'deploy agents', 'browser login', 'remember this',
  'github repo', 'vault credential', 'create a task', 'research the web',
]) {
  for (const f of suggestCapabilitiesForMessage(m)) allSuggestionFamilies.add(f);
}
for (const f of allSuggestionFamilies) {
  check(`suggested family "${f}" is known`, isKnownCapabilityFamily(f));
}

// ── isKnownCapabilityFamily ────────────────────────────────────────────────
check('isKnownCapabilityFamily("browser") true', isKnownCapabilityFamily('browser'));
check('isKnownCapabilityFamily("desktop") true', isKnownCapabilityFamily('desktop'));
check('isKnownCapabilityFamily("team.deploy_agents") true', isKnownCapabilityFamily('team.deploy_agents'));
check('isKnownCapabilityFamily("nope") false', !isKnownCapabilityFamily('nope'));
check('isKnownCapabilityFamily("") false', !isKnownCapabilityFamily(''));
check('isKnownCapabilityFamily(null) false', !isKnownCapabilityFamily(null));

// ── report ─────────────────────────────────────────────────────────────────
const total = passed + failed;
console.log(`\nchat-capability-manifest smoke: ${passed}/${total} assertions passed.`);
if (failed > 0) {
  console.error(`${failed} assertion(s) FAILED.`);
  process.exit(1);
}
console.log('OK');
