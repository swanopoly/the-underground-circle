export type AutomationVerificationGateKind =
  | 'captcha'
  | 'bot_check'
  | 'mfa'
  | 'login_challenge'
  | 'unknown';

export interface AutomationVerificationGate {
  detected: true;
  kind: AutomationVerificationGateKind;
  label: string;
  reason: string;
  matchedTerms: string[];
  requiresHumanPause: true;
  canAutomate: false;
  pauseInstruction: string;
}

type VerificationDetector = {
  kind: AutomationVerificationGateKind;
  label: string;
  reason: string;
  patterns: RegExp[];
};

export const HUMAN_VERIFICATION_PAUSE_MESSAGE =
  'Human verification detected. Pause automation and ask the user to complete the verification manually, then continue only after the user confirms it is done.';

const DETECTORS: VerificationDetector[] = [
  {
    kind: 'captcha',
    label: 'CAPTCHA / human verification',
    reason: 'The page or target appears to contain CAPTCHA or "not a robot" verification.',
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
    label: 'Bot verification / security check',
    reason: 'The page or target appears to be an anti-bot or security challenge.',
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
    label: 'MFA / one-time verification code',
    reason: 'The page or target appears to require a human-controlled security code or authenticator step.',
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
    label: 'Login challenge',
    reason: 'The page or target appears to need a human login challenge or identity confirmation.',
    patterns: [
      /\bconfirm\s+(?:your\s+)?identity\b/i,
      /\bidentity\s+verification\b/i,
      /\btrusted\s+device\b/i,
      /\bapprove\s+(?:this\s+)?(?:login|sign[-\s]?in)\b/i,
      /\bdevice\s+verification\b/i,
    ],
  },
];

function normalizeSignal(value: string | null | undefined): string {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

export function detectAutomationVerificationGate(
  input: string | Array<string | null | undefined> | null | undefined,
): AutomationVerificationGate | null {
  const signals = Array.isArray(input) ? input : [input];
  const text = signals.map(normalizeSignal).filter(Boolean).join('\n').slice(0, 50_000);
  if (!text) return null;

  for (const detector of DETECTORS) {
    const matchedTerms = detector.patterns
      .map((pattern) => text.match(pattern)?.[0])
      .filter((term): term is string => Boolean(term));
    if (matchedTerms.length === 0) continue;
    return {
      detected: true,
      kind: detector.kind,
      label: detector.label,
      reason: detector.reason,
      matchedTerms: Array.from(new Set(matchedTerms.map((term) => term.slice(0, 120)))),
      requiresHumanPause: true,
      canAutomate: false,
      pauseInstruction: HUMAN_VERIFICATION_PAUSE_MESSAGE,
    };
  }

  return null;
}

export function buildAutomationVerificationSafetyNotes(
  input: string | Array<string | null | undefined> | null | undefined,
): string[] {
  const gate = detectAutomationVerificationGate(input);
  if (!gate) return [];
  return [
    `${gate.label}: ${gate.reason}`,
    gate.pauseInstruction,
  ];
}

export function isAutomationVerificationTarget(
  input: string | Array<string | null | undefined> | null | undefined,
): boolean {
  return detectAutomationVerificationGate(input) !== null;
}
