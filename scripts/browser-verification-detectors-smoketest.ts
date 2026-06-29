/**
 * browser-verification-detectors-smoketest — guards the human-verification
 * gate detectors in scripts/browser-bridge.js. When any of these patterns
 * match a page/target signal, detectVerificationGate must return
 * requiresHumanPause:true / canAutomate:false so the bridge fires
 * writeHumanVerificationPause (errorCode 'human_verification_required',
 * mapped to needs_user by src/lib/browserBridgeFailure.ts) and never tries
 * to automate the step.
 *
 * The VERIFICATION_DETECTORS array below is a MANUAL MIRROR of the array in
 * scripts/browser-bridge.js (kept in sync by hand — same convention as
 * scripts/browser-bridge-smoketest.ts / browser-action-verification-smoketest.ts).
 * The bridge file can't be imported here because its top-level Playwright
 * require would break under tsx.
 *
 * Run: `npx tsx scripts/browser-verification-detectors-smoketest.ts`
 */

// ── Mirror of scripts/browser-bridge.js VERIFICATION_DETECTORS (all 6 kinds) ──
const VERIFICATION_DETECTORS = [
  {
    kind: 'captcha',
    patterns: [
      /\bcaptcha\b/i,
      /\brecaptcha\b/i,
      /\bhcaptcha\b/i,
      /\bturnstile\b/i,
      /\bi\s*(?:am|'m|m)\s+not\s+a\s+robot\b/i,
      /\bnot\s+a\s+robot\b/i,
      /\bverify\s+(?:you(?:'re| are)|that\s+you\s+are)\s+(?:human|not\s+a\s+robot)\b/i,
      /\bhuman\s+verification\b/i,
    ],
  },
  {
    kind: 'bot_check',
    patterns: [
      /\bbot\s+(?:check|verification|challenge|protection)\b/i,
      /\banti[-\s]?bot\b/i,
      /\bcloudflare\b[\s\S]{0,80}\b(?:challenge|security|verify|checking)\b/i,
      /\bchecking\s+(?:your\s+)?browser\b/i,
      /\bsecurity\s+check\b/i,
      /\bverify\s+(?:you(?:'re| are)|that\s+you\s+are)\s+human\b/i,
      /\bprove\s+(?:you(?:'re| are)|that\s+you\s+are)\s+human\b/i,
    ],
  },
  {
    kind: 'mfa',
    patterns: [
      /\b(?:two[-\s]?factor|2fa|mfa|multi[-\s]?factor)\b/i,
      /\b(?:one[-\s]?time|single[-\s]?use)\s+(?:password|passcode|code)\b/i,
      /\b(?:otp|totp)\b/i,
      /\bauthenticator\s+(?:app|code)\b/i,
      /\bverification\s+code\b/i,
      /\bsecurity\s+code\b/i,
    ],
  },
  {
    kind: 'login_challenge',
    patterns: [
      /\bconfirm\s+(?:your\s+)?identity\b/i,
      /\bidentity\s+verification\b/i,
      /\btrusted\s+device\b/i,
      /\bapprove\s+(?:this\s+)?(?:login|sign[-\s]?in)\b/i,
      /\bdevice\s+verification\b/i,
    ],
  },
  {
    kind: 'passkey',
    patterns: [
      /\bpasskey(?:s)?\b/i,
      /\bwebauthn\b/i,
      /\bsecurity\s+key\b/i,
      /\bwindows\s+hello\b/i,
      /\b(?:face|touch)\s*id\b/i,
      /\bfingerprint\b/i,
      /\bnavigator\.credentials\b/i,
      /\binsert\s+your\s+security\s+key\b/i,
    ],
  },
  {
    kind: 'push_2fa',
    patterns: [
      /\btap\s+yes\s+on\s+your\s+phone\b/i,
      /\bapprove\s+the\s+notification\b/i,
      /\bcheck\s+your\s+phone\b/i,
      /\bwe\s+sent\s+a\s+notification\s+to\s+your\s+device\b/i,
      /\bopen\s+your\s+authenticator\s+app\s+and\s+approve\b/i,
    ],
  },
];

// Copy of detectVerificationGate's match logic (return-block essentials).
interface GateResult {
  kind: string;
  requiresHumanPause: boolean;
  canAutomate: boolean;
}

function detectVerificationGate(signals: unknown): GateResult | null {
  const text = (Array.isArray(signals) ? signals : [signals])
    .map((value) => String(value || '').replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join('\n')
    .slice(0, 50000);
  if (!text) return null;
  for (const detector of VERIFICATION_DETECTORS) {
    const matched = detector.patterns.some((pattern) => pattern.test(text));
    if (!matched) continue;
    return { kind: detector.kind, requiresHumanPause: true, canAutomate: false };
  }
  return null;
}

let failures = 0;
function ok(msg: string) { console.log('  ok:', msg); }
function fail(msg: string, detail?: unknown) {
  failures += 1;
  console.error('FAIL:', msg);
  if (detail !== undefined) console.error('  detail:', JSON.stringify(detail));
}

function expectKind(signal: string, expected: string) {
  const gate = detectVerificationGate(signal);
  if (!gate) { fail(`"${signal}" — expected kind ${expected}, got null`); return; }
  if (gate.kind !== expected) { fail(`"${signal}" — expected ${expected}, got ${gate.kind}`); return; }
  if (gate.requiresHumanPause !== true || gate.canAutomate !== false) {
    fail(`"${signal}" — wrong pause flags`, gate); return;
  }
  ok(`"${signal}" → ${expected} (pause:true, automate:false)`);
}

function expectNull(signal: string) {
  const gate = detectVerificationGate(signal);
  if (gate === null) ok(`"${signal}" → no gate`);
  else fail(`"${signal}" — expected null, got ${gate.kind}`);
}

// ── Passkey / WebAuthn / biometric ──────────────────────────────────────────
console.log('\npasskey detectors');
expectKind('Please use your passkey to continue', 'passkey');
expectKind('Insert your security key', 'passkey');
expectKind('Sign in with Windows Hello', 'passkey');
expectKind('Use Face ID to verify', 'passkey');
expectKind('Touch ID required', 'passkey');
expectKind('Calling navigator.credentials.get()', 'passkey');
expectKind('WebAuthn challenge', 'passkey');
// `face|touch id` must not match a bare "face".
expectNull('Look at the face in the photo');

// ── Push / device approval ──────────────────────────────────────────────────
console.log('\npush_2fa detectors');
expectKind('Tap Yes on your phone', 'push_2fa');
expectKind('Approve the notification we just sent', 'push_2fa');
expectKind('Check your phone to continue', 'push_2fa');
expectKind('We sent a notification to your device', 'push_2fa');
// "authenticator app" also matches the existing mfa detector, which sits
// earlier in the array, so this canonical push phrase resolves to mfa — still
// a human-pause gate (same contract). Assert it pauses regardless of kind.
{
  const gate = detectVerificationGate('Open your authenticator app and approve the request');
  if (gate && gate.requiresHumanPause && !gate.canAutomate) ok('"authenticator app + approve" → human pause gate (mfa/push)');
  else fail('"authenticator app + approve" should pause', gate);
}
// A pure push phrase with no mfa keyword resolves to push_2fa.
expectKind('Please tap Yes on your phone now', 'push_2fa');

// ── Regression: the four original kinds still match canonical strings ────────
console.log('\nexisting detectors (regression)');
expectKind('Please complete the reCAPTCHA', 'captcha');
expectKind('Checking your browser before you proceed', 'bot_check');
expectKind('Enter the verification code we sent', 'mfa');
expectKind('Please confirm your identity', 'login_challenge');

// ── Benign content returns null ──────────────────────────────────────────────
console.log('\nbenign content');
expectNull('Add to cart');
expectNull('');

// ── Result ───────────────────────────────────────────────────────────────────
console.log('\n' + (failures > 0 ? `FAILED — ${failures} assertion(s)` : 'PASSED — all assertions ok'));
process.exit(failures > 0 ? 1 : 0);
