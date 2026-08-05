/**
 * desktop-automation-safety-smoketest - locks bot verification handling.
 *
 * Agents can inspect, click, type, and fill forms, but CAPTCHA/MFA/bot
 * checks must pause for the human instead of being automated.
 *
 * Run: npm run smoke:desktop-automation-safety
 */

import {
  detectAutomationVerificationGate,
  isAutomationVerificationTarget,
} from '../src/lib/desktopAutomationSafety';
import { analyzeBrowserTask } from '../src/lib/browserTaskIntent';
import { planComputerTaskPreview } from '../src/lib/computerTaskPlanner';

let failures = 0;

function fail(message: string) {
  failures += 1;
  console.error('FAIL:', message);
}

function pass(message: string) {
  console.log('pass:', message);
}

function assert(condition: unknown, message: string, detail?: string) {
  if (condition) pass(message);
  else fail(`${message}${detail ? ` - ${detail}` : ''}`);
}

function main() {
  const captcha = detectAutomationVerificationGate("click the I'm not a robot checkbox");
  assert(captcha?.kind === 'captcha', 'captcha target is detected', captcha?.kind);
  assert(captcha?.canAutomate === false, 'captcha cannot be automated');
  assert(captcha?.requiresHumanPause === true, 'captcha requires human pause');

  const cloudflare = detectAutomationVerificationGate('Cloudflare is checking your browser before accessing the site');
  assert(cloudflare?.kind === 'bot_check', 'Cloudflare security page is detected', cloudflare?.kind);

  const mfa = detectAutomationVerificationGate('Enter the verification code from your authenticator app');
  assert(mfa?.kind === 'mfa', 'MFA verification code is detected', mfa?.kind);

  assert(!isAutomationVerificationTarget('click the Save button'), 'normal button is not blocked');
  assert(!detectAutomationVerificationGate('fill the email field and submit the form'), 'normal form fill is not verification');

  const preview = planComputerTaskPreview('Fill the login form, then pause when the site shows bot verification');
  assert(preview.kind === 'browser_task', 'bot verification routes as browser task', preview.kind);
  assert(preview.verificationGate?.kind === 'bot_check', 'computer task preview carries verification gate', preview.verificationGate?.kind);
  assert(preview.requiredCapabilities.includes('browser_automation'), 'browser automation capability remains required');
  assert((preview.safetyNotes || []).some((note) => /Pause automation/i.test(note)), 'preview includes pause safety note');

  const browserIntent = analyzeBrowserTask('Log in and wait if a CAPTCHA appears');
  assert(browserIntent.verificationGate?.kind === 'captcha', 'browser intent carries verification gate', browserIntent.verificationGate?.kind);
  assert(browserIntent.risk === 'high', 'browser verification raises risk');
  assert(browserIntent.suggestedPermission === 'ask_every_time', 'browser verification keeps strict approval');
  assert(browserIntent.completionCriteria.some((item) => /Pause/i.test(item)), 'browser intent completion includes human pause');

  if (failures > 0) {
    console.error(`\n${failures} desktop automation safety smoke-test failure(s)`);
    process.exit(1);
  }
  console.log('\nAll desktop automation safety smoke cases passed.');
}

main();
