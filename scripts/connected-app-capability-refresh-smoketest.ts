/**
 * Provider-aware connected app-capability recovery smoke.
 *
 * The live runtime imports React Native/Supabase surfaces, so this smoke pins
 * the integration seams at source level and exercises the provider-neutral
 * strict receipt parser as real TypeScript.
 *
 * Run:
 *   npx tsx scripts/connected-app-capability-refresh-smoketest.ts
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseAgentAppCapabilityBuildoutResultFromSession } from '../src/lib/agentAppCapabilityBuildout';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const read = (relative: string) => readFileSync(`${repoRoot}/${relative}`, 'utf8');

const computerRuntime = read('src/lib/computerTaskRuntime.ts');
const toolRuntime = read('src/lib/openswanToolRuntime.ts');
const dispatcher = read('src/lib/connectedAgentDispatch.ts');
const claudeDetector = read('src/lib/claudeCodeDetector.ts');
const claudeBridge = read('scripts/claude-bridge.js');

assert.match(
  computerRuntime,
  /provider:\s*normalizeComputerTaskCapabilityProvider\(buildout\.provider\)/,
  'computer task state records the provider returned by capability dispatch',
);
assert.match(
  computerRuntime,
  /refreshComputerTaskCapabilityBuildoutFromConnectedAgentSession/,
  'runtime exports a provider-aware capability-result refresher',
);
assert.match(
  computerRuntime,
  /provider === 'codex'[\s\S]*?fetchCodexSessions[\s\S]*?provider === 'claude-code'[\s\S]*?fetchClaudeCodeSessions/,
  'refresher polls the session bridge selected at dispatch',
);
assert.match(
  computerRuntime,
  /status:\s*'incomplete'[\s\S]*?does not yet expose a trustworthy bounded result receipt/,
  'unsupported result providers terminate explicitly without auto-retry',
);
assert.match(
  computerRuntime,
  /prefixMatches\.length === 1/,
  'shortened session ids must resolve uniquely rather than attaching another agent result',
);
assert.match(
  computerRuntime,
  /refreshComputerTaskCapabilityBuildoutFromCodexSession\s*=\s*[\r\n\s]*refreshComputerTaskCapabilityBuildoutFromConnectedAgentSession/,
  'legacy ChatTab import delegates to provider-aware behavior',
);

const buildoutCaseStart = toolRuntime.lastIndexOf("case 'agent.build_app_capability':");
const buildoutCaseEnd = toolRuntime.indexOf("case 'team.deploy_agents':", buildoutCaseStart);
assert(buildoutCaseStart >= 0 && buildoutCaseEnd > buildoutCaseStart);
const buildoutCase = toolRuntime.slice(buildoutCaseStart, buildoutCaseEnd);
assert.match(
  buildoutCase,
  /providerOrder:\s*\['codex',\s*'claude-code'\]/,
  'capability buildout prefers only providers with a strict result channel',
);
assert.match(
  buildoutCase,
  /allowedProviders:\s*\['codex',\s*'claude-code'\]/,
  'an explicit stale session id cannot escape the strict-result provider lane',
);
assert.match(
  dispatcher,
  /allowed\.has\(session\.provider\)/,
  'connected-agent dispatcher applies the hard allowlist to session reuse',
);

assert.match(
  claudeDetector,
  /appCapabilityResultText\?: string/,
  'Claude detector exposes the dedicated bounded capability receipt',
);
assert.match(
  claudeBridge,
  /appCapabilityResultText/,
  'Claude bridge publishes the dedicated capability receipt',
);

const claudeReceipt = parseAgentAppCapabilityBuildoutResultFromSession({
  sessionId: 'claude-capability-1234',
  appCapabilityResultText: `
APP_CAPABILITY_SUMMARY: Added the reusable native-app route.
APP_CAPABILITY_CONTROL_SURFACE: official app CLI with accessibility verification.
APP_CAPABILITY_SOURCE_REFS:
- Official app CLI documentation: https://example.com/app/cli
- src/lib/computerAppGrounding.ts
FILES_CHANGED:
- src/lib/computerAppGrounding.ts
RETRY_PLAN: Retry the original app task once.
VERIFICATION: focused smoke passed.
USER_ACTION_NEEDED: none
`,
});
assert.equal(claudeReceipt?.status, 'ready_to_retry');
assert.equal(claudeReceipt?.verified, true);

const incompleteClaudeReceipt = parseAgentAppCapabilityBuildoutResultFromSession({
  sessionId: 'claude-capability-5678',
  appCapabilityResultText: `
APP_CAPABILITY_SUMMARY: Added a tentative menu recipe.
APP_CAPABILITY_CONTROL_SURFACE: accessibility menu path.
RETRY_PLAN: Retry after review.
VERIFICATION: smoke passed.
USER_ACTION_NEEDED: none
`,
});
assert.equal(
  incompleteClaudeReceipt?.status,
  'incomplete',
  'missing source evidence cannot trigger automatic retry',
);

console.log('connected app capability refresh smoke passed');
