/**
 * conversational-router-smoketest — guards the legacy conversationalRouter
 * approval-bypass fix (item 1.3):
 *
 *  1. Publish/mutation-shaped detections ("put X on my website") must NEVER
 *     execute a live WordPress publish from the legacy detect-then-execute
 *     path. `executeConversationalIntent` returns the `null` route-to-planner
 *     sentinel (the ChatTab consumer treats an unhandled result as "fall
 *     through to the normal chat pipeline", where the planner's approval gate
 *     or the SwanBot tool loop owns the mutation).
 *  2. The approval-gated unified path (`executeDetectedConversationalIntent`,
 *     invoked post-approval by the dispatcher) still executes publishes — the
 *     guard must not break approved WordPress work.
 *  3. Casual image mentions ("a photo of my dog from yesterday") are no
 *     longer hijacked into /imagine; imperative generation requests still are.
 *
 * Imports the REAL module (statically dependency-light — see the R8 note at
 * the top of conversationalRouter.ts). Injected context executors keep every
 * case here free of dynamic supabase/runtime imports.
 *
 * Run: npx tsx scripts/conversational-router-smoketest.ts
 */

import {
  detectConversationalIntent,
  executeConversationalIntent,
  executeDetectedConversationalIntent,
  legacyPathRequiresApprovalGate,
  looksLikeCredentialMemoryContent,
  type ConversationalIntent,
  type ConversationalIntentContext,
} from '../src/lib/conversationalRouter';

let failures = 0;
let passes = 0;
function pass(message: string): void {
  passes += 1;
  console.log('pass:', message);
}
function fail(message: string): void {
  failures += 1;
  console.error('FAIL:', message);
}
function assert(condition: unknown, message: string, detail?: string): void {
  if (condition) pass(message);
  else fail(`${message}${detail ? ` — ${detail}` : ''}`);
}
function assertEqual<T>(actual: T, expected: T, message: string): void {
  assert(
    actual === expected,
    message,
    `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
  );
}

type PublishSpy = { calls: number };

function buildContext(fullMessage: string, spies: {
  publish: PublishSpy;
  wpCommands: string[];
  hfCommands: string[];
}): ConversationalIntentContext {
  return {
    circleId: 'c1',
    threadId: 't1',
    sourceMessageId: 'm1',
    userId: 'u1',
    userName: 'Smoke',
    fullMessage,
    executeWordPressPublish: async () => {
      spies.publish.calls += 1;
      return { message: 'published (spy)' };
    },
    executeWpCommand: async (input) => {
      spies.wpCommands.push(input);
      return { success: true, message: 'wp (spy)' } as any;
    },
    executeHfCommand: async (input) => {
      spies.hfCommands.push(input);
      return { success: true, message: 'imagined (spy)' } as any;
    },
  };
}

async function main(): Promise<void> {
  // ─── (a) publish-shaped legacy detection never reaches a live publish ────
  {
    const message = 'put this announcement on my site';
    const intent = detectConversationalIntent(message);
    assertEqual(intent.type, 'wordpress_publish', '(a) "put X on my site" still detected as wordpress_publish');
    assert(legacyPathRequiresApprovalGate(intent), '(a) wordpress_publish is flagged as approval-gate-required on the legacy path');

    const spies = { publish: { calls: 0 }, wpCommands: [] as string[], hfCommands: [] as string[] };
    const result = await executeConversationalIntent(intent, buildContext(message, spies));
    assertEqual(result, null, '(a) legacy executor returns the null route-to-planner sentinel');
    assertEqual(spies.publish.calls, 0, '(a) executeWordPressPublish was never invoked from the legacy path');
    assertEqual(spies.wpCommands.length, 0, '(a) no /wp command executed from the legacy path');
  }

  // ─── (a1) "put X on my website" phrasing can never direct-publish ────────
  {
    const message = 'put this announcement on my website';
    const intent = detectConversationalIntent(message);
    // Whatever this detects as, the legacy path may never publish it.
    const gatedOrNone = intent.type === 'none' || legacyPathRequiresApprovalGate(intent);
    assert(gatedOrNone, '(a1) "put X on my website" is either undetected or approval-gated', `detected as ${intent.type}`);
    const spies = { publish: { calls: 0 }, wpCommands: [] as string[], hfCommands: [] as string[] };
    const result = await executeConversationalIntent(intent, buildContext(message, spies));
    assert(!result?.handled, '(a1) legacy executor never handles it directly');
    assertEqual(spies.publish.calls, 0, '(a1) executeWordPressPublish never invoked');
    assertEqual(spies.wpCommands.length, 0, '(a1) no /wp command executed');
  }

  // ─── (a2) explicit "publish"-status phrasing is gated too ────────────────
  {
    const message = 'publish a post about our launch to wordpress and make it live';
    const intent = detectConversationalIntent(message);
    assertEqual(intent.type, 'wordpress_publish', '(a2) explicit publish phrasing detected as wordpress_publish');
    if (intent.type === 'wordpress_publish') {
      assertEqual(intent.status, 'publish', '(a2) status extracted as live publish');
    }
    const spies = { publish: { calls: 0 }, wpCommands: [] as string[], hfCommands: [] as string[] };
    const result = await executeConversationalIntent(intent, buildContext(message, spies));
    assertEqual(result, null, '(a2) live-publish intent returns the sentinel, never executes');
    assertEqual(spies.publish.calls, 0, '(a2) publish executor never invoked');
  }

  // ─── (a3) schedule (auto-"confirm" /wp command) is gated on legacy path ──
  {
    const message = 'schedule a blog post about AI agents for next monday';
    const intent = detectConversationalIntent(message);
    assertEqual(intent.type, 'wordpress_schedule', '(a3) schedule phrasing detected as wordpress_schedule');
    assert(legacyPathRequiresApprovalGate(intent), '(a3) wordpress_schedule is flagged as approval-gate-required on the legacy path');
    const spies = { publish: { calls: 0 }, wpCommands: [] as string[], hfCommands: [] as string[] };
    const result = await executeConversationalIntent(intent, buildContext(message, spies));
    assertEqual(result, null, '(a3) schedule intent returns the sentinel from the legacy path');
    assertEqual(spies.wpCommands.length, 0, '(a3) no auto-confirmed /wp schedule command executed');
  }

  // ─── unified (post-approval) path still executes WordPress work ──────────
  {
    const intent: ConversationalIntent = { type: 'wordpress_publish', title: 'Launch recap', status: 'draft' };
    const spies = { publish: { calls: 0 }, wpCommands: [] as string[], hfCommands: [] as string[] };
    const result = await executeDetectedConversationalIntent(intent, buildContext('publish launch recap to wordpress', spies));
    assertEqual(result?.handled, true, 'unified path: approved wordpress_publish still executes');
    assertEqual(spies.publish.calls, 1, 'unified path: executeWordPressPublish invoked exactly once');
  }

  // ─── read-only WordPress listing stays on the legacy path ────────────────
  {
    const message = 'show my wordpress drafts';
    const intent = detectConversationalIntent(message);
    assertEqual(intent.type, 'wordpress_list', 'read-only: listing detected as wordpress_list');
    assert(!legacyPathRequiresApprovalGate(intent), 'read-only: wordpress_list is not gated');
    const spies = { publish: { calls: 0 }, wpCommands: [] as string[], hfCommands: [] as string[] };
    const result = await executeConversationalIntent(intent, buildContext(message, spies));
    assertEqual(result?.handled, true, 'read-only: listing still handled on the legacy path');
    assertEqual(spies.wpCommands[0], '/wp list drafts', 'read-only: routed to the /wp list command');
  }

  // ─── (b) casual image mentions are NOT hijacked into /imagine ────────────
  {
    const intent = detectConversationalIntent('a photo of my dog from yesterday');
    assertEqual(intent.type, 'none', '(b) "a photo of my dog from yesterday" is not an image-generation intent');
  }
  {
    const intent = detectConversationalIntent('can you find the picture of the whiteboard from our meeting');
    assert(intent.type !== 'generate_image', '(b2) "find the picture of ..." is not hijacked to /imagine');
  }

  // ─── (c) imperative generation still routes to /imagine ──────────────────
  {
    const message = 'generate an image of a sunset';
    const intent = detectConversationalIntent(message);
    assertEqual(intent.type, 'generate_image', '(c) "generate an image of a sunset" detected as generate_image');
    const spies = { publish: { calls: 0 }, wpCommands: [] as string[], hfCommands: [] as string[] };
    const result = await executeConversationalIntent(intent, buildContext(message, spies));
    assertEqual(result?.handled, true, '(c) image generation handled on the legacy path');
    assertEqual(spies.hfCommands[0], `/imagine ${message}`, '(c) routed through the /imagine HF command');
  }
  {
    const message = 'generate an image of a sunset';
    const spies = { publish: { calls: 0 }, wpCommands: [] as string[], hfCommands: [] as string[] };
    const context = buildContext(message, spies);
    delete context.sourceMessageId;
    const result = await executeDetectedConversationalIntent(
      { type: 'generate_image', prompt: message },
      context,
    );
    assertEqual(result?.handled, true, '(c1) missing persisted image source fails closed with a handled explanation');
    assertEqual(spies.hfCommands.length, 0, '(c1) missing persisted image source never calls the image executor');
    assert(/saved Chat message|not sent/i.test(result?.message || ''), '(c1) failure explains that no provider request started');
  }
  {
    const intent = detectConversationalIntent('draw a picture of a dragon');
    assertEqual(intent.type, 'generate_image', '(c2) "draw a picture of a dragon" detected as generate_image');
  }
  {
    const intent = detectConversationalIntent('make me a logo for the underground circle');
    assertEqual(intent.type, 'generate_image', '(c3) "make me a logo ..." detected as generate_image');
  }

  if (failures > 0) {
    console.error(`\n${failures} failure(s), ${passes} passed`);
    process.exit(1);
  }
  // ─── (P24) memory-intent classification: imperative save vs recall/nostalgia ───
  {
    assertEqual(detectConversationalIntent('remember that our standup is at 9:15am').type, 'remember', '(P24) imperative "remember that…" saves');
    assertEqual(detectConversationalIntent('what do you remember about me?').type, 'show_memories', '(P24) "what do you remember…" recalls, never saves');
    assertEqual(detectConversationalIntent('remember when we went to the beach?').type, 'none', '(P24) "remember when…?" nostalgia is not a save');
    assertEqual(detectConversationalIntent('forget what I said about the deadline').type, 'forget', '(P24) "forget what I said about X" deletes');
    assertEqual(detectConversationalIntent('forget everything about project X').type, 'forget', '(P24) "forget everything about X" deletes');
    assertEqual(detectConversationalIntent('I forget what that error was').type, 'none', '(P24) mid-sentence "I forget…" statement is not a delete command');
  }

  // ─── (P24) credential guard: secrets never persist to memory ───────────────
  {
    assert(looksLikeCredentialMemoryContent('my wifi password is hunter2'), '(P24) password+value flagged as credential');
    assert(looksLikeCredentialMemoryContent('api key: sk-abc123def456'), '(P24) api key flagged as credential');
    assert(!looksLikeCredentialMemoryContent('our standup is at 9:15am'), '(P24) ordinary fact is not a credential');
    assert(!looksLikeCredentialMemoryContent('I prefer dark mode'), '(P24) preference is not a credential');
    const spies = { publish: { calls: 0 }, wpCommands: [] as string[], hfCommands: [] as string[] };
    let rememberCalls = 0;
    const ctx = { ...buildContext('remember my wifi password is hunter2', spies), executeRemember: async () => { rememberCalls += 1; return { message: 'saved' }; } } as ConversationalIntentContext;
    const result = await executeConversationalIntent({ type: 'remember', content: 'my wifi password is hunter2' }, ctx);
    assert(rememberCalls === 0, '(P24) credential remember NEVER reaches the persistence path', `calls=${rememberCalls}`);
    assert(!!result?.handled && /1Password|vault|secret/i.test(result.message), '(P24) credential remember returns a vault-pointer refusal', result?.message);
  }

  // ─── (C2) ported-pattern coverage stays intact on the legacy detector ──────
  // These are the phrasings the classify-once cutover ported INTO the planner
  // (chatAutomationPlanner.ts detectPlannerConversationalIntent) so ChatTab can
  // stop re-classifying. The planner smoke (chat-planner-smoketest) proves the
  // planner now catches them; here we keep the legacy detector's own coverage
  // so an accidental edit to conversationalRouter patterns can't silently drop
  // the coverage the planner is kept in LOCKSTEP with.
  {
    assertEqual(detectConversationalIntent('make a work item for reviewing the invoice').type, 'create_task', '(C2) "make a work item …" detected as create_task');
    assertEqual(detectConversationalIntent('add a work item to review the landing page').type, 'create_task', '(C2) "add a work item …" detected as create_task');

    const spinMeUp = detectConversationalIntent('spin me up an agent called Scout and add it to the task we just made');
    assertEqual(spinMeUp.type, 'office_agent_task', '(C2) "spin me up an agent called X … task" detected as office_agent_task');
    if (spinMeUp.type === 'office_agent_task') {
      assertEqual(spinMeUp.agentName, 'Scout', '(C2) "spin me up …" extracts the agent name');
      assertEqual(spinMeUp.taskTarget, 'latest_user_task', '(C2) "task we just made" targets the latest user task');
    }

    const bareAgent = detectConversationalIntent('the agent called Pixel Pro, add it to the latest task');
    assertEqual(bareAgent.type, 'office_agent_task', '(C2) "the agent called X, add it to the latest task" detected as office_agent_task (no creation verb)');
    if (bareAgent.type === 'office_agent_task') {
      assertEqual(bareAgent.taskTarget, 'latest_circle_task', '(C2) "latest task" targets the latest circle task');
    }

    // Guardrail: the widened create_task/office triggers must not swallow chat.
    assertEqual(detectConversationalIntent('what can this app do?').type, 'none', '(C2) guardrail: plain orientation question is not a task/office intent');
  }

  console.log(`\nAll conversational-router smoke cases passed (${passes} passed).`);
}

main().catch((err) => { console.error('smoke crashed:', err); process.exit(1); });
