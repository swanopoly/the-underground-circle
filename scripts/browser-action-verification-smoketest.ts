/**
 * browser-action-verification-smoketest — offline guard for the advisory
 * post-action verification planner.
 *
 * Run: npm run smoke:browser-action-verification
 */

import { planPostActionVerification } from '../src/lib/browserActionVerification';

let failures = 0;
function fail(m: string): void { failures += 1; console.error('FAIL:', m); }
function pass(m: string): void { console.log('pass:', m); }
function assert(cond: unknown, name: string, detail?: string): void {
  if (cond) pass(name); else fail(`${name}${detail ? ` — ${detail}` : ''}`);
}

{
  const p = planPostActionVerification({ type: 'fill', target: 'Email', value: 'x@y.z' });
  assert(p.shouldVerify, 'fill: should verify');
  assert(p.evidence.includes('browser.dom_snapshot'), 'fill: dom snapshot evidence', JSON.stringify(p.evidence));
  assert(p.checks.some((c) => /value|char/i.test(c)), 'fill: confirms field value', JSON.stringify(p.checks));
  assert(p.checks[0].includes('Email'), 'fill: names the target field', p.checks[0]);
}
{
  const p = planPostActionVerification({ type: 'click', target: 'Submit' });
  assert(p.shouldVerify, 'click: should verify');
  assert(p.evidence.includes('browser.dom_snapshot') && p.evidence.includes('browser.screenshot'), 'click: dom + screenshot', JSON.stringify(p.evidence));
  assert(p.checks.some((c) => /state change/i.test(c)), 'click: confirms state change');
}
{
  const p = planPostActionVerification({ type: 'navigate', value: 'https://example.com' });
  assert(p.shouldVerify, 'navigate: should verify');
  assert(p.evidence.includes('browser.verification_state'), 'navigate: verification_state evidence', JSON.stringify(p.evidence));
  assert(p.checks.some((c) => /url|title/i.test(c)), 'navigate: confirms url/title');
}
{
  const p = planPostActionVerification({ type: 'select', target: 'Country' });
  assert(p.shouldVerify && p.evidence.includes('browser.dom_snapshot'), 'select: should verify with dom snapshot');
}
{
  const p = planPostActionVerification({ type: 'upload', target: 'Resume' });
  assert(p.shouldVerify && p.evidence.includes('browser.screenshot'), 'upload: should verify with screenshot');
}
{
  const p = planPostActionVerification({ type: 'hover', target: 'menu' });
  assert(!p.shouldVerify && p.checks.length === 0 && p.evidence.length === 0, 'hover: no verification (pure observation)');
}
{
  const p = planPostActionVerification({ type: 'something_unknown' });
  assert(!p.shouldVerify, 'unknown: no verification by default');
}

if (failures > 0) {
  console.error(`\n${failures} browser-action-verification smoke-test failure(s)`);
  process.exit(1);
}
console.log('\nAll browser-action-verification smoke cases passed.');
