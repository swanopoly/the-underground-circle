/**
 * computer-use-backend-routing-smoketest
 *
 * Locks the cost/security routing behavior for Computer Use:
 * - sessions initialize approved domains from the analyzed intent
 * - simple read/extract work prefers the free local browser bridge
 * - login/account read-only work can stay local; form/high-risk workflows
 *   route to Browserbase/Stagehand when connected
 *
 * Run: npm run smoke:computer-use-backend
 */

import { analyzeBrowserTask } from '../src/lib/browserTaskIntent';
import { chooseBrowserAutomationBackendPreference } from '../src/lib/browserAutomationBackend';
import fs from 'node:fs';

let failures = 0;
function pass(message: string) { console.log('pass:', message); }
function fail(message: string) { failures += 1; console.error('FAIL:', message); }
function assert(condition: unknown, message: string, detail?: string) {
  if (condition) pass(message);
  else fail(`${message}${detail ? ` - ${detail}` : ''}`);
}

async function main() {
  const readOnly = analyzeBrowserTask('Open https://example.com/docs and summarize the page');
  assert(
    chooseBrowserAutomationBackendPreference(readOnly).backend === 'local_browser_bridge',
    'read-only browser task prefers local bridge',
  );

  const extraction = analyzeBrowserTask('Extract product names and prices from https://example.com/catalog as JSON');
  assert(
    chooseBrowserAutomationBackendPreference(extraction).backend === 'local_browser_bridge',
    'simple extraction prefers local bridge',
  );

  const stagehand = analyzeBrowserTask('Use Stagehand to click through https://example.com onboarding and extract the result');
  assert(
    chooseBrowserAutomationBackendPreference(stagehand).backend === 'browserbase_stagehand',
    'explicit Stagehand task prefers Browserbase/Stagehand',
  );

  const localLogin = analyzeBrowserTask('Use my local browser to log in to https://example.com/admin and tell me the dashboard status');
  assert(
    chooseBrowserAutomationBackendPreference(localLogin).backend === 'local_browser_bridge',
    'explicit local login task prefers local browser bridge',
  );

  const readOnlyLogin = analyzeBrowserTask('Log in to https://example.com/admin and summarize the dashboard status');
  assert(
    chooseBrowserAutomationBackendPreference(readOnlyLogin).backend === 'local_browser_bridge',
    'read-only login task prefers local browser bridge for cost control',
  );

  const login = analyzeBrowserTask('Log in to https://example.com/admin and update the profile form after I approve');
  assert(
    chooseBrowserAutomationBackendPreference(login).backend === 'browserbase_stagehand',
    'login/form task prefers Browserbase/Stagehand',
  );

  const computerUseSource = fs.readFileSync('src/lib/computerUse.ts', 'utf8');
  assert(
    computerUseSource.includes('approvedDomains: intent.allowedDomains ? [...intent.allowedDomains] : []'),
    'session approvedDomains initialize from analyzed intent',
  );
  assert(
    computerUseSource.includes("jsonrpc: '2.0'") && computerUseSource.includes("method: 'tools/call'"),
    'legacy MCP fallback sends JSON-RPC 2.0 tools/call payload',
  );
  assert(computerUseSource.includes("label: 'Local Browser Bridge'"), 'local backend label is explicit');

  const dispatchSource = fs.readFileSync('src/lib/computerTaskDispatch.ts', 'utf8');
  assert(dispatchSource.includes('Browser backend policy:'), 'chat dispatch prefix exposes backend policy');
  assert(
    dispatchSource.includes('follow the browser backend policy'),
    'chat dispatch guidance follows backend policy instead of a fixed paid backend',
  );
  assert(
    !dispatchSource.includes('prioritize Browserbase/remote browser execution'),
    'chat dispatch no longer forces every browser task through Browserbase',
  );

  if (failures > 0) {
    console.error(`\n${failures} computer-use backend routing failure(s)`);
    process.exit(1);
  }
  console.log('\nAll computer-use backend routing smoke cases passed.');
}

main().catch((err) => {
  console.error('fatal:', err);
  process.exit(1);
});
