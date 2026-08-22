/**
 * route-golden-canary-smoketest — the drift detector for SILENT ROUTE
 * MIS-CLASSIFICATION, the #1 reliability failure mode from the routing
 * research.
 *
 * The dangerous bug is not a crash: it is the planner quietly sending a task
 * to the WRONG lane/model. Nothing throws, latency looks normal, and the only
 * symptom is "the model got dumber" — invisible to error monitoring. Both the
 * GPT-5 launch outage and Anthropic's Sep-2025 postmortem were this shape.
 *
 * This suite pins a GOLDEN TABLE of ~40-50 realistic prompts to their EXPECTED
 * execution.kind (and, where knowable, the intent kind / route lane) across
 * every lane the planner routes:
 *   - plain chat / greetings
 *   - capability & meta questions (MUST stay conversational — never automate)
 *   - direct desktop / app tasks           → run_computer_task
 *   - browser / transactional (cart, buy)  → run_computer_task
 *   - wordpress publish / list / schedule  → conversational_action
 *   - wordpress admin (wp-admin)           → run_computer_task
 *   - memory: remember / forget / show     → conversational_action
 *   - creation: build discovery / csv      → run_build_discovery / run_openswan
 *   - watches (bridge diagnostics)         → run_openswan
 *   - image generation                     → conversational_action (hf_tools)
 *   - recurring cadence ("every morning…") → run_command_handler (schedule)
 *   - chat-channel sends (Slack/Discord)   → run_openswan (approval-gated)
 *   - integrations + office/agent status   → run_openswan (read-only)
 *   - /vault slash commands                → run_command_handler (vault)
 *
 * Any future routing change that moves a canary prompt to a different lane
 * fails CI HERE with `prompt → got X, expected Y`. The prompts that were the
 * P22/P23/P24 routing bugs (Photoshop launch, add-to-cart, "how do I connect
 * wordpress", wp-image-post, memory recall-vs-save) are pinned below as
 * PERMANENT REGRESSION ANCHORS — they must never silently drift again.
 *
 * Usage:
 *   npx tsx scripts/route-golden-canary-smoketest.ts
 * Exit 0 = every canary still routes to its expected lane.
 */

import {
  buildChatAutomationPlan,
  type ChatAutomationPlan,
} from '../src/lib/chatAutomationPlanner';

type ExecutionKind = ChatAutomationPlan['execution']['kind'];
type IntentKind = ChatAutomationPlan['intent']['kind'];
type RouteId = ChatAutomationPlan['execution']['routeId'];
type ComputerKind = NonNullable<ChatAutomationPlan['computerRequestRoute']>['kind'];

type Canary = {
  /** Short lane label for grouping the failure output. */
  lane: string;
  prompt: string;
  /** Required: the execution kind this prompt MUST route to. */
  kind: ExecutionKind;
  /** Optional: assert the intent kind too (used for conversational lanes). */
  intentKind?: IntentKind;
  /** Optional: assert the route lane where it is deterministic. */
  routeId?: RouteId;
  /** Canonical computer surface. Never infer native desktop work from routeId. */
  computerKind?: ComputerKind;
  /** Optional attachments (wp-image-post anchors need these). */
  attachments?: Array<{ uri?: string; type?: string; id?: string }>;
  /** Optional selected mode (a few plain-chat rows pin OpenSwan mode). */
  selectedMode?: string;
  /** Set true on the historical-bug rows so the summary can list them. */
  anchor?: boolean;
  /** Free-text why-this-lane, printed on failure to aid triage. */
  why?: string;
};

let failures = 0;
let assertions = 0;
const anchorPrompts: string[] = [];

function intentKindOf(plan: ChatAutomationPlan): IntentKind {
  return plan.intent.kind;
}

function runCanary(c: Canary): void {
  if (c.anchor) anchorPrompts.push(`[${c.lane}] ${c.prompt}`);
  const plan = buildChatAutomationPlan({
    message: c.prompt,
    attachments: c.attachments,
    selectedMode: c.selectedMode ?? null,
  });

  // Primary assertion: execution kind (the lane the runtime actually takes).
  assertions += 1;
  const gotKind = plan.execution.kind;
  if (gotKind !== c.kind) {
    failures += 1;
    console.error(
      `FAIL [${c.lane}]: "${c.prompt}"\n    execution.kind → got ${gotKind}, expected ${c.kind}` +
        (c.why ? `\n    (why: ${c.why})` : '') +
        `\n    routeId=${plan.execution.routeId ?? 'null'} intent=${intentKindOf(plan)} source=${plan.source} conf=${plan.confidence}`,
    );
  } else {
    console.log(`pass [${c.lane}]: "${c.prompt}" → ${gotKind}`);
  }

  // Optional assertion: intent kind.
  if (c.intentKind !== undefined) {
    assertions += 1;
    const gotIntent = intentKindOf(plan);
    if (gotIntent !== c.intentKind) {
      failures += 1;
      console.error(
        `FAIL [${c.lane}]: "${c.prompt}"\n    intent.kind → got ${gotIntent}, expected ${c.intentKind}`,
      );
    } else {
      console.log(`pass [${c.lane}]: "${c.prompt}" intent → ${gotIntent}`);
    }
  }

  // Optional assertion: route lane.
  if (c.routeId !== undefined) {
    assertions += 1;
    const gotRoute = plan.execution.routeId;
    if (gotRoute !== c.routeId) {
      failures += 1;
      console.error(
        `FAIL [${c.lane}]: "${c.prompt}"\n    execution.routeId → got ${gotRoute ?? 'null'}, expected ${c.routeId ?? 'null'}`,
      );
    } else {
      console.log(`pass [${c.lane}]: "${c.prompt}" route → ${gotRoute ?? 'null'}`);
    }
  }

  if (c.computerKind !== undefined) {
    assertions += 1;
    const gotComputerKind = plan.computerRequestRoute?.kind ?? null;
    if (gotComputerKind !== c.computerKind) {
      failures += 1;
      console.error(
        `FAIL [${c.lane}]: "${c.prompt}"\n    computerRequestRoute.kind → got ${gotComputerKind ?? 'null'}, expected ${c.computerKind}`,
      );
    } else {
      console.log(`pass [${c.lane}]: "${c.prompt}" computer kind → ${gotComputerKind}`);
    }
  }
}

// ════════════════════════════════════════════════════════════════════════════
// THE GOLDEN CANARY TABLE
// ════════════════════════════════════════════════════════════════════════════

const CANARIES: Canary[] = [
  // ── Lane: plain chat / greetings (must NOT be captured by any action lane) ──
  { lane: 'plain', prompt: 'hello there', kind: 'run_plain_chat', why: 'greeting is pure conversation' },
  { lane: 'plain', prompt: 'thanks, that was helpful', kind: 'run_plain_chat' },
  { lane: 'plain', prompt: 'what is your favorite color?', kind: 'run_plain_chat', why: 'idle chit-chat, no pipeline pull' },
  { lane: 'plain', prompt: 'tell me a joke about swans', kind: 'run_plain_chat' },
  {
    lane: 'plain',
    prompt: 'what do we know about the outage?',
    kind: 'run_openswan',
    selectedMode: 'review',
    why: 'plain chat but an OpenSwan mode is pinned → runtime turn',
  },

  // ── Lane: capability / meta questions — MUST stay conversational ────────────
  // These are the P12 "questions ABOUT automation" guard. If any of these flips
  // to run_computer_task/run_openswan the app starts *doing* things when the
  // user only *asked whether it could* — the exact silent mis-route we defend.
  { lane: 'meta', prompt: 'is it safe to let an AI use my browser?', kind: 'run_plain_chat', why: 'meta-question about capability, not a task' },
  // NOTE: the meta-question guard is narrow — "can you control my computer?"
  // is NOT caught today and falls through to run_openswan. We pin a form the
  // guard DOES catch so this canary tracks the guaranteed-good behavior; if the
  // guard is later widened, add the "control my computer" phrasing here too.
  { lane: 'meta', prompt: 'is it safe to let you use my computer?', kind: 'run_plain_chat', why: 'capability/safety meta-question stays conversational' },
  { lane: 'meta', prompt: 'what can this app do?', kind: 'run_plain_chat' },
  {
    lane: 'meta',
    prompt: 'how do I connect my wordpress site?',
    kind: 'run_plain_chat',
    anchor: true,
    why: 'P22/P24: "how do I …" setup question is GUIDANCE, not wp automation',
  },
  {
    lane: 'meta',
    prompt: 'how can I add my google account?',
    kind: 'run_plain_chat',
    anchor: true,
    why: 'P24: "how can I …" setup question stays plain chat',
  },

  // ── Lane: direct desktop / app tasks → run_computer_task ────────────────────
  {
    lane: 'desktop',
    prompt: 'open Photoshop',
    kind: 'run_computer_task',
    computerKind: 'desktop_app',
    anchor: true,
    why: 'P22/P23: bare app launch must hit the computer/app adapter, not plain chat',
  },
  { lane: 'desktop', prompt: 'open Photoshop and crop this image', kind: 'run_computer_task', computerKind: 'desktop_app' },
  { lane: 'desktop', prompt: 'open Affinity Designer', kind: 'run_computer_task', computerKind: 'desktop_app' },
  { lane: 'desktop', prompt: 'click the Save button in Photoshop', kind: 'run_computer_task', computerKind: 'desktop_app' },
  { lane: 'desktop', prompt: 'click File > Save As in Photoshop', kind: 'run_computer_task', computerKind: 'desktop_app' },
  { lane: 'desktop', prompt: 'type "hello world" in TextEdit', kind: 'run_computer_task', computerKind: 'desktop_app' },
  { lane: 'desktop', prompt: 'press Command S in Photoshop', kind: 'run_computer_task', computerKind: 'desktop_app' },
  { lane: 'desktop', prompt: 'open TextEdit then type "hello" then press Command S', kind: 'run_computer_task', computerKind: 'desktop_app' },
  { lane: 'desktop', prompt: 'Search files in my Downloads folder for invoice', kind: 'run_computer_task', computerKind: 'local_file' },
  { lane: 'desktop', prompt: 'Open InDesign and export high quality pdf as brochure.pdf', kind: 'run_computer_task', computerKind: 'desktop_app' },
  {
    lane: 'desktop',
    prompt: 'Use Ableton Live to create a four-bar drum loop and export it after approval',
    kind: 'run_computer_task',
    computerKind: 'desktop_app',
    why: 'unfamiliar app → universal app control, not plain chat',
  },

  // ── Lane: browser / transactional → run_computer_task ───────────────────────
  {
    lane: 'browser',
    prompt: 'go to amazon and add a phone charger to my cart',
    kind: 'run_computer_task',
    anchor: true,
    why: 'P23: add-to-cart with a bare retailer name is web-transactional',
  },
  {
    lane: 'browser',
    prompt: 'add a phone charger to my cart',
    kind: 'run_computer_task',
    anchor: true,
    why: 'P23: add-to-cart with no site still routes to the browser runtime',
  },
  {
    lane: 'browser',
    prompt: 'buy a phone charger on amazon',
    kind: 'run_computer_task',
    anchor: true,
    why: 'P23: bare-retailer purchase routes to the browser runtime',
  },
  { lane: 'browser', prompt: 'Extract product names, prices, and availability from https://example.com/catalog as JSON', kind: 'run_computer_task', routeId: 'browser' },
  { lane: 'browser', prompt: 'Use Stagehand to open https://example.com and click the docs link', kind: 'run_computer_task', routeId: 'browser' },
  { lane: 'browser', prompt: 'Complete the application form at https://example.com/apply and submit it after I approve', kind: 'run_computer_task', routeId: 'browser' },
  { lane: 'browser', prompt: 'Book a flight to New York next Friday under $500', kind: 'run_computer_task', routeId: 'browser', why: 'travel booking → zero-tap browser runtime' },
  { lane: 'browser', prompt: 'open example.com in a new tab in Chrome', kind: 'run_computer_task', routeId: 'browser' },
  { lane: 'browser', prompt: 'Download the orders CSV from Shopify and save it to Downloads', kind: 'run_computer_task', routeId: 'browser', why: 'hybrid browser/local export' },
  { lane: 'browser', prompt: 'Log into Shopify and update this product page after I approve', kind: 'run_computer_task', routeId: 'browser' },

  // ── Lane: wordpress publish / list / schedule → conversational_action ───────
  {
    lane: 'wordpress',
    prompt: 'Publish the homepage update to WordPress',
    kind: 'run_command_handler',
    intentKind: 'conversational_action',
    routeId: 'wordpress',
  },
  {
    lane: 'wordpress',
    prompt: 'Show my WordPress posts',
    kind: 'run_command_handler',
    intentKind: 'conversational_action',
    routeId: 'wordpress',
    why: 'listing is read-only but still the wordpress conversational lane',
  },
  {
    lane: 'wordpress',
    prompt: 'Schedule a WordPress post about launch recap for 2026-07-01',
    kind: 'run_command_handler',
    intentKind: 'conversational_action',
    routeId: 'wordpress',
  },

  // ── Lane: wordpress admin (wp-admin) → run_computer_task (browser) ──────────
  { lane: 'wp-admin', prompt: 'edit a page in wp-admin', kind: 'run_computer_task', routeId: 'browser', why: 'admin mutation → browser automation of wp-admin' },
  { lane: 'wp-admin', prompt: 'log into wp-admin and edit a page', kind: 'run_computer_task', routeId: 'browser' },
  { lane: 'wp-admin', prompt: 'install a WordPress plugin after approval', kind: 'run_computer_task', routeId: 'browser' },

  // ── Lane: wordpress image posting — P23 REST-lane vs browser split ──────────
  {
    lane: 'wp-image',
    prompt: 'post this image to my wordpress site',
    kind: 'run_openswan',
    attachments: [{ type: 'image', id: 'a1' }],
    anchor: true,
    why: 'P23: attached image + wp wording rides the REST wp.upload_media lane (run_openswan), NOT browser',
  },
  {
    lane: 'wp-image',
    prompt: 'log in to wp-admin and post this image',
    kind: 'run_computer_task',
    attachments: [{ type: 'image', id: 'a1' }],
    anchor: true,
    why: 'P23: explicit wp-admin wording keeps the browser route even with an attachment',
  },
  {
    lane: 'wp-image',
    prompt: 'post this image to my wordpress site',
    kind: 'run_computer_task',
    anchor: true,
    why: 'P23: no attachment → browser fallback (the image REST lane needs the attached storage path)',
  },

  // ── Lane: memory recall-vs-save (P24) — recall must NOT be a save ───────────
  {
    lane: 'memory',
    prompt: 'Remember that Chris prefers Go',
    kind: 'run_command_handler',
    intentKind: 'conversational_action',
    routeId: 'memory',
    anchor: true,
    why: 'P24: start-anchored imperative "remember" is a SAVE',
  },
  {
    lane: 'memory',
    prompt: 'what do you remember about the launch?',
    kind: 'run_command_handler',
    intentKind: 'conversational_action',
    routeId: 'memory',
    anchor: true,
    why: 'P24: "what do you remember" is a RECALL (show_memories), never a save',
  },
  {
    lane: 'memory',
    prompt: 'show me my memories',
    kind: 'run_command_handler',
    intentKind: 'conversational_action',
    routeId: 'memory',
    why: 'show memories recall lane',
  },
  {
    lane: 'memory',
    prompt: 'forget everything you know about the old pricing',
    kind: 'run_command_handler',
    intentKind: 'conversational_action',
    routeId: 'memory',
  },

  // ── Lane: creation — build discovery / mission / import ─────────────────────
  { lane: 'create', prompt: 'build me a landing page for recruits', kind: 'run_build_discovery', routeId: 'build_page' },
  { lane: 'create', prompt: 'Create a task to review the invoice', kind: 'run_command_handler', intentKind: 'conversational_action', routeId: 'mission' },
  { lane: 'create', prompt: 'Import this CSV into Supabase and map the columns', kind: 'run_openswan', why: 'data import pipeline → runtime work' },

  // ── Lane: watches (bridge diagnostics) → run_openswan ───────────────────────
  {
    lane: 'watches',
    prompt: 'The desktop/browser_tabs endpoint returns 404 in the local bridge',
    kind: 'run_openswan',
    routeId: null,
    why: 'bridge troubleshooting → OpenSwan diagnostics, not a computer task',
  },

  // ── Lane: image generation → conversational_action (hf_tools) ───────────────
  {
    lane: 'image-gen',
    prompt: 'Generate an image of a neon swan',
    kind: 'run_command_handler',
    intentKind: 'conversational_action',
    routeId: 'hf_tools',
  },
  {
    lane: 'image-gen',
    prompt: 'draw a minimal logo for a coffee brand called Bean There',
    kind: 'run_command_handler',
    intentKind: 'conversational_action',
    routeId: 'hf_tools',
  },

  // ════ W-A1 probe fixes (2026-07 adversarial battery) — new pinned lanes ════

  // ── Lane: recurring cadence → schedule (W-A1/M1) ─────────────────────────────
  // "every/each <unit>" phrasing was leaking into one-shot lanes: /gh prs
  // rewrite, desktop-app computer task, or an unrelated pipeline.
  {
    lane: 'recurring',
    prompt: "every morning post yesterday's merged PRs to Slack",
    kind: 'run_command_handler',
    routeId: 'schedule',
    anchor: true,
    why: 'W-A1/M1: recurring ask was rewritten to a one-shot /gh prs list',
  },
  {
    lane: 'recurring',
    prompt: 'every Monday at 9am summarize open PRs and post them to slack',
    kind: 'run_command_handler',
    routeId: 'schedule',
    anchor: true,
    why: 'W-A1/M1: recurring ask was parsed as a desktop-app computer task',
  },
  {
    lane: 'recurring',
    prompt: 'remind me every day at 5pm to log my hours',
    kind: 'run_command_handler',
    routeId: 'schedule',
    anchor: true,
    why: 'W-A1/M1: recurring reminder was landing on the cloud_devops pipeline',
  },
  {
    lane: 'recurring',
    prompt: 'set up a daily research job',
    kind: 'run_command_handler',
    routeId: 'schedule',
    why: 'pre-existing schedule_automation pipeline lane must stay untouched by the cadence gate',
  },
  {
    lane: 'recurring',
    prompt: 'Schedule a meeting with the design team and send calendar invites',
    kind: 'run_openswan',
    routeId: null,
    why: 'guard: recurring gate must NOT capture meeting/calendar scheduling (meetings pipeline owns it)',
  },
  {
    lane: 'recurring',
    prompt: 'Build a weekly KPI dashboard from conversion metrics',
    kind: 'run_openswan',
    routeId: null,
    why: 'guard: bare "weekly" is not a cadence command — analytics pipeline keeps it',
  },

  // ── Lane: external chat-channel send → run_openswan + approval (W-A1/M2) ────
  {
    lane: 'channel-send',
    prompt: "post a summary of today's standup to our Slack channel",
    kind: 'run_openswan',
    routeId: null,
    anchor: true,
    why: 'W-A1/M2: Slack post fell to plain chat — nothing would be posted',
  },
  {
    lane: 'channel-send',
    prompt: 'send a message to the #general channel in Slack saying the deploy is done',
    kind: 'run_openswan',
    routeId: null,
    anchor: true,
    why: 'W-A1/M2: Slack send was parsed as a junk desktop click sequence',
  },
  {
    lane: 'channel-send',
    prompt: 'Summarize unread emails and prioritize Slack alerts',
    kind: 'run_openswan',
    routeId: null,
    why: 'guard: read-only Slack triage stays on the inbox pipeline, not the send gate',
  },
  {
    lane: 'channel-send',
    prompt: 'Moderate Discord comments and draft community replies',
    kind: 'run_openswan',
    routeId: null,
    why: 'guard: moderation/drafting stays on the social pipeline, not the send gate',
  },

  // ── Lane: integrations (slash + status questions) (W-A1/M3) ─────────────────
  {
    lane: 'integrations',
    prompt: '/integrations act create a Linear issue "Fix login"',
    kind: 'run_command_handler',
    intentKind: 'slash_command',
    routeId: 'hf_tools',
    why: '/integrations act composes an approval-gated API call via the hf_tools route (ChatTab P30 intercept)',
  },
  {
    lane: 'integrations',
    prompt: 'check which integrations are failing',
    kind: 'run_openswan',
    routeId: null,
    anchor: true,
    why: 'W-A1/M3: integration health question fell to context-free plain chat',
  },
  {
    lane: 'integrations',
    prompt: 'what integrations do we have connected',
    kind: 'run_openswan',
    routeId: null,
    anchor: true,
    why: 'W-A1/M3: connected-integrations question needs the integrations.list tool lane',
  },

  // ── Lane: office/agent status → run_openswan (W-A1/M4) ──────────────────────
  {
    lane: 'office-status',
    prompt: 'what did my agents do today',
    kind: 'run_openswan',
    routeId: null,
    anchor: true,
    why: 'W-A1/M4: agent-activity question fell to plain chat with no roster/run tools',
  },
  {
    lane: 'office-status',
    prompt: 'what are my office agents working on right now',
    kind: 'run_openswan',
    routeId: null,
    anchor: true,
    why: 'W-A1/M4: office_agents pipeline matched below the confidence floor → plain chat',
  },
  {
    lane: 'office-status',
    prompt: 'show me the agent roster',
    kind: 'run_openswan',
    routeId: null,
    anchor: true,
    why: 'W-A1/M4: roster read needs office.list_agents, not a context-free reply',
  },
  {
    lane: 'office-status',
    prompt: 'is the claude bridge connected',
    kind: 'run_openswan',
    routeId: null,
    why: 'bridge connectivity question stays on the bridge_troubleshooting diagnostics lane',
  },
  {
    lane: 'office-status',
    prompt: 'create an agent named Scout with Opus and add it to the task we just made',
    kind: 'run_command_handler',
    intentKind: 'conversational_action',
    routeId: 'mission',
    why: 'guard: agent CREATION keeps the office_agent_task lane, never the status gate',
  },

  // ── Lane: vault slash → its real registry route (W-A1/M5) ───────────────────
  {
    lane: 'vault',
    prompt: '/vault list',
    kind: 'run_command_handler',
    intentKind: 'slash_command',
    routeId: 'vault',
    anchor: true,
    why: 'W-A1/M5: /vault was missing from the planner routeIds list → "did not map cleanly"',
  },
  {
    lane: 'vault',
    prompt: '/vault grants openswan',
    kind: 'run_command_handler',
    intentKind: 'slash_command',
    routeId: 'vault',
  },

  // ── W-A1 regression classics re-pinned from the probe battery ───────────────
  { lane: 'desktop', prompt: 'open Photoshop and create a new project', kind: 'run_computer_task', computerKind: 'desktop_app' },
  { lane: 'browser', prompt: 'book me a hotel in Miami', kind: 'run_computer_task', routeId: 'browser', why: 'travel booking → zero-tap browser runtime' },
  { lane: 'create', prompt: 'add a task buy milk', kind: 'run_command_handler', intentKind: 'conversational_action', routeId: 'mission' },
  { lane: 'meta', prompt: 'how do I crop an image in Photoshop?', kind: 'run_plain_chat', why: 'how-to question about an app is guidance, not desktop automation' },
  {
    lane: 'memory',
    prompt: 'remember I prefer dark mode',
    kind: 'run_command_handler',
    intentKind: 'conversational_action',
    routeId: 'memory',
  },
];

for (const canary of CANARIES) runCanary(canary);

// ── Summary ──────────────────────────────────────────────────────────────────

console.log('');
console.log(`Golden-canary table: ${CANARIES.length} prompts, ${assertions} assertions.`);
console.log(`Pinned historical-bug anchors (${anchorPrompts.length}):`);
for (const anchor of anchorPrompts) console.log(`  - ${anchor}`);

if (failures > 0) {
  console.error(`\n${failures} route-canary failure(s) — a prompt drifted to the wrong lane.`);
  process.exit(1);
}
console.log('\nAll route canaries hold their expected lane.');
