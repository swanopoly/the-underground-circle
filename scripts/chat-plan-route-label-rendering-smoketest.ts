/**
 * chat-plan-route-label-rendering-smoketest
 *
 * Pins the final display label used by ChatAutomationPlanCard. The handoff
 * surface is intentionally coarser than the canonical automation plan, so it
 * may repair historical placeholder labels but must never mask current route
 * kinds such as hybrid or connected-agent capability buildout.
 *
 * Run: `npx tsx scripts/chat-plan-route-label-rendering-smoketest.ts`
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildChatAutomationPlan } from '../src/lib/chatAutomationPlanner';
import { buildChatAutomationPlanPreview } from '../src/lib/chatAutomationPlanPreview';
import { resolveChatAutomationPlanDisplayRouteLabel } from '../src/lib/chatRecoveryDisplayCore';

function previewFor(message: string) {
  return buildChatAutomationPlanPreview(buildChatAutomationPlan({ message }));
}

function assertRenderedLabel(
  message: string,
  expectedKind: string,
  expectedLabel: string,
  legacyOverride: string,
): void {
  const plan = buildChatAutomationPlan({ message });
  const preview = buildChatAutomationPlanPreview(plan);
  assert.equal(plan.computerRequestRoute?.kind, expectedKind);
  assert.equal(preview.routeLabel, expectedLabel);
  assert.equal(
    resolveChatAutomationPlanDisplayRouteLabel(preview.routeLabel, legacyOverride),
    expectedLabel,
    `${expectedKind} canonical route label survives the legacy ${legacyOverride} override`,
  );
}

assertRenderedLabel(
  'Open Photoshop and create a new 600 by 600 document',
  'desktop_app',
  'Desktop app',
  'Computer',
);

assertRenderedLabel(
  'Search files in my Downloads folder for invoice',
  'local_file',
  'Local files',
  'Computer',
);

assertRenderedLabel(
  'download the report from the portal, then import it into the spreadsheet app',
  'hybrid',
  'Browser + desktop',
  'Computer',
);

assertRenderedLabel(
  'have the attached Codex agent download whatever assets it needs to finish the website task',
  'agent_buildout',
  'Capability buildout',
  'Desktop app',
);

assert.equal(
  resolveChatAutomationPlanDisplayRouteLabel('browser', 'Desktop app'),
  'Desktop app',
  'historical lowercase browser placeholder still accepts the handoff repair',
);
assert.equal(
  resolveChatAutomationPlanDisplayRouteLabel('direct', 'Local files'),
  'Local files',
  'historical lowercase direct placeholder still accepts the handoff repair',
);
assert.equal(
  resolveChatAutomationPlanDisplayRouteLabel('Browser', 'Computer'),
  'Browser',
  'current canonical Browser label is not masked by a coarser handoff',
);
assert.equal(
  resolveChatAutomationPlanDisplayRouteLabel('', 'Desktop app'),
  'Desktop app',
  'missing historical preview labels retain the handoff fallback',
);

const componentSource = readFileSync(
  new URL('../src/screens/circles/tabs/chat/ChatAutomationPlanCard.tsx', import.meta.url),
  'utf8',
);
assert.match(
  componentSource,
  /resolveChatAutomationPlanDisplayRouteLabel\(preview\.routeLabel, routeLabelOverride\)/,
  'ChatAutomationPlanCard renders through the canonical-first display resolver',
);
assert.match(
  componentSource,
  /\{routeLabel\}<\/Text>/,
  'the resolved routeLabel is the value rendered in the Route row',
);

assert.equal(previewFor('hello').routeLabel, 'Chat', 'plain chat remains on the Chat label');

console.log('All Chat plan route-label rendering smoke cases passed.');
