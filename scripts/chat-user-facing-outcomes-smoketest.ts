/**
 * chat-user-facing-outcomes-smoketest — verifies the plain-language failure
 * translator (Phase 2a of docs/CHAT_UX_INTEGRATION_UPGRADE_PLAN.md):
 * classification→copy mapping, provider naming, marketplace blockers, the
 * computer-use display policy, the desktop-bridge reachability classification
 * (concrete fix + `/apps` recheck hint, P17), and the never-lose-detail null
 * contract.
 *
 * Run: npm run smoke:chat-user-facing-outcomes
 */

import {
  detectBridgeReachabilityKind,
  detectProviderName,
  formatChatUserFacingOutcome,
  providerBlockerFromFailure,
  translateChatFailure,
  translateComputerUseErrorMessage,
} from '../src/lib/chatUserFacingOutcomes';

let failures = 0;

function fail(message: string) {
  failures += 1;
  console.error('FAIL:', message);
}

function pass(message: string) {
  console.log('pass:', message);
}

function expect(condition: unknown, message: string) {
  if (!condition) fail(message);
}

// ── Bridge failures → start-the-bridge action ───────────────────────────────
{
  const outcome = translateChatFailure('Desktop bridge offline — connection refused at localhost:7778');
  expect(!!outcome, 'desktop bridge error classifies');
  expect(outcome!.actionTarget === 'bridge', 'bridge failure targets the bridge');
  expect(/npm run bridge/.test(outcome!.nextAction || ''), 'bridge failure tells the user the exact start command');
  expect(!/ECONN|localhost|7778/.test(outcome!.summary), 'bridge summary carries no transport jargon');
  pass('bridge offline → plain summary + start command');
}

// ── Provider key missing → Marketplace with provider named ─────────────────
{
  const raw = 'key_missing: add your own OpenAI API key to use this model';
  const outcome = translateChatFailure(raw);
  expect(!!outcome, 'missing key classifies');
  expect(outcome!.actionTarget === 'marketplace', 'missing key routes to Marketplace');
  expect(outcome!.provider === 'OpenAI', 'provider name detected from the error');
  expect(/OpenAI/.test(outcome!.summary), 'summary names the provider');
  expect(/Marketplace/.test(outcome!.nextAction || ''), 'next action points at Marketplace');
  expect(outcome!.userActionRequired, 'missing key requires the user');

  const blocker = providerBlockerFromFailure(raw);
  expect(!!blocker && blocker.provider === 'OpenAI', 'missing key produces an attention-strip provider blocker');
  pass('missing provider key → Marketplace action naming OpenAI');
}

// ── Rate limit → wait-or-switch, still a marketplace blocker ────────────────
{
  const outcome = translateChatFailure('429 too many requests from openrouter/auto');
  expect(!!outcome, 'rate limit classifies');
  expect(outcome!.provider === 'OpenRouter', 'rate limit names OpenRouter');
  expect(/rate-limited/.test(outcome!.summary), 'rate limit summary is plain');
  pass('rate limit → plain wait-or-switch copy');
}

// ── Transient provider failure is NOT a strip blocker ───────────────────────
{
  const blocker = providerBlockerFromFailure('Navigation timed out after 30000ms');
  expect(blocker === null, 'transient failures never become provider blockers');
  pass('transient failures stay out of the attention strip');
}

// ── Budget cap → approvals, resumable ───────────────────────────────────────
{
  const outcome = translateChatFailure('Run stopped: budget exceeded for circle (cost cap $10)');
  expect(!!outcome, 'budget cap classifies');
  expect(outcome!.actionTarget === 'approvals', 'budget cap routes to approvals');
  expect(/resume/.test(outcome!.nextAction || ''), 'budget cap promises resume after approval');
  pass('budget cap → approvals + resume');
}

// ── Auth / human verification → live view handoff ──────────────────────────
{
  const auth = translateChatFailure('401 unauthorized');
  expect(!!auth && auth.actionTarget === 'live_view', 'auth failure hands off to the live view');
  expect(/sign in|log in/i.test(auth!.summary + (auth!.nextAction || '')), 'auth copy says to sign in');
  pass('auth required → live-view sign-in handoff');
}

// ── Model tool support → settings/model picker ──────────────────────────────
{
  const outcome = translateChatFailure('model does not support tool types: computer_20250124');
  expect(!!outcome, 'unsupported tool classifies');
  expect(/model/i.test(outcome!.summary), 'unsupported tool summary mentions the model');
  expect(/Sonnet/.test(outcome!.nextAction || ''), 'unsupported tool suggests a working model');
  pass('model tool unsupported → pick-a-capable-model');
}

// ── formatChatUserFacingOutcome shape ───────────────────────────────────────
{
  const outcome = translateChatFailure('Desktop bridge offline — not running')!;
  const formatted = formatChatUserFacingOutcome(outcome);
  expect(formatted.includes(outcome.summary), 'format includes the summary');
  expect(formatted.includes('**Next:**'), 'format includes the Next: line');
  expect(formatChatUserFacingOutcome(outcome, { includeNext: false }) === outcome.summary, 'includeNext:false → summary only');
  pass('formatter shape');
}

// ── Computer-use display policy ─────────────────────────────────────────────
{
  expect(
    translateComputerUseErrorMessage('Cancelled by user.') === 'Cancelled by user.',
    'cancellations pass through untouched',
  );
  const translated = translateComputerUseErrorMessage('Desktop bridge offline — not connected');
  expect(/npm run bridge/.test(translated), 'classified computer-use errors become summary + next action');
  const jargon = translateComputerUseErrorMessage('stack overflow at frame 42 in supabase client');
  expect(
    jargon === 'Computer Use could not finish. Technical details were saved for recovery.',
    'unclassified jargon falls back to the safe generic line',
  );
  const plain = translateComputerUseErrorMessage('The page needed a different postcode.');
  expect(plain === 'The page needed a different postcode.', 'unclassified plain text passes through');
  expect(
    translateComputerUseErrorMessage('') === 'Computer Use could not finish. Technical details were saved for recovery.',
    'empty message → generic line',
  );
  pass('computer-use display policy: cancel / translate / jargon / plain');
}

// ── Bridge reachability failures → concrete fix + /apps recheck (P17) ───────
{
  const offline = translateChatFailure('Desktop bridge offline — connection refused at localhost:7778');
  expect(!!offline && offline.failureClass === 'desktop_bridge_offline', 'desktop bridge offline classifies via the reachability patterns');
  expect(/npm run bridge/.test(offline!.nextAction || ''), 'offline next action keeps the exact start command');
  expect(/\/apps/.test(offline!.nextAction || ''), 'offline next action points at /apps for the recheck');
  expect(offline!.actionTarget === 'bridge', 'offline still targets the bridge');

  const outdated = translateChatFailure('The desktop bridge is running an older build — missing cad_compile');
  expect(!!outdated, 'older-build phrase classifies (the taxonomy alone missed it)');
  expect(outdated!.failureClass === 'bridge_endpoint_missing', 'older build maps to bridge_endpoint_missing');
  expect(/npm run bridge/.test(outdated!.nextAction || ''), 'older-build next action says restart with npm run bridge');
  expect(/\/apps/.test(outdated!.nextAction || ''), 'older-build next action mentions /apps');

  const engine = translateChatFailure('cad_compile failed: engine_not_installed (freecadcmd)');
  expect(!!engine && engine.failureClass === 'cli_missing', 'engine_not_installed classifies as cli_missing');
  expect(/install/i.test(engine!.nextAction || ''), 'engine next action says install');
  expect(/\/apps/.test(engine!.nextAction || ''), 'engine next action mentions /apps');

  const unreachable = translateChatFailure('BRIDGE UNREACHABLE while probing health');
  expect(!!unreachable && /\/apps/.test(unreachable.nextAction || ''), 'bridge unreachable (case-insensitive) classifies with the /apps hint');
  const notPaired = translateChatFailure('bridge not paired with this app');
  expect(!!notPaired && notPaired.actionTarget === 'bridge', 'bridge not paired classifies to the bridge target');
  expect(!!notPaired && notPaired.userActionRequired, 'bridge reachability failures require the user');

  expect(detectBridgeReachabilityKind('bridge is running an older build') === 'bridge_outdated', 'detector maps the older-build phrase');
  expect(detectBridgeReachabilityKind('The recipe needed more flour') === null, 'unrelated text detects no bridge kind');
  expect(translateChatFailure('The recipe needed more flour') === null, 'unrelated failure still returns null (null contract preserved)');
  expect(providerBlockerFromFailure('Desktop bridge offline — not running') === null, 'bridge failures never become marketplace blockers');
  pass('bridge reachability → npm run bridge / install + /apps recheck, null contract intact');
}

// ── Null contract: unknown failures never get worse ─────────────────────────
{
  expect(translateChatFailure('Something odd happened xyz') === null, 'unclassifiable input → null (caller keeps its copy)');
  expect(detectProviderName('no provider mentioned here') === null, 'no provider → null');
  pass('null contract for unknown failures');
}

if (failures > 0) {
  console.error(`\n${failures} chat user-facing outcomes smoke failure(s)`);
  process.exit(1);
}

console.log('\nAll chat user-facing outcomes smoke cases passed.');
