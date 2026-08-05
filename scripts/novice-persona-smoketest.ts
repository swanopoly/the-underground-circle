/**
 * novice-persona-smoketest — end-to-end persona testing of the chat's
 * decision layers (P12). Persona: "Dana, 52, curious about agentic AI,
 * first week in the app." Every battery drives the SAME pure modules
 * ChatTab wires (planner, message routing, auto-model + reason, command
 * registry, watch/bestof grammars, attention queue, failure translation,
 * room-handoff detector) with realistic novice phrasing, and asserts the
 * experience never dead-ends: no crashes, no hijacked messages, no jargon,
 * commands discoverable, safety floors intact.
 *
 * Run: npm run smoke:novice-persona
 */

import { buildChatAutomationPlan } from '../src/lib/chatAutomationPlanner';
import { analyzeMessageRouting } from '../src/lib/messageRouting';
import { explainAutoModelChoice, resolveModelForSoul } from '../src/lib/serviceProfileSouls';
import {
  detectAlwaysConfirmFloorCategories,
} from '../src/lib/chatComputerRequestRouter';
import { looksLikeAppGroundedMessage } from '../src/lib/blackswanRouting';
import { getMatchingChatSlashCommands } from '../src/lib/chatSlashCommands';
import { getChatCommandByCommand } from '../src/lib/chatCommandRegistry';
import { executeWatchCommand } from '../src/lib/watchChatCommands';
import { parseBestOfNCommand, resolveRaceModels, runBestOfNRace } from '../src/lib/bestOfNRace';
import { buildChatAttentionState } from '../src/lib/chatAttentionQueue';
import { translateChatFailure, providerBlockerFromFailure } from '../src/lib/chatUserFacingOutcomes';
import { detectRoomHandoffSuggestion } from '../src/lib/chatRoomHandoff';

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

const PROVIDERS = new Set(['anthropic', 'blackswan']);

async function main() {
  // ── Battery 1: orientation questions never hijack, always resolve a model ──
  {
    const questions = [
      'What can this app do?',
      'How do I get started with AI agents? This is all new to me.',
      'Is it safe to let an AI use my browser?',
      "I heard about agentic AI on a podcast — what's the simplest thing I can try here?",
      'what is my circle streak?',
    ];
    for (const q of questions) {
      const plan = buildChatAutomationPlan({ message: q, surface: 'main_chat' } as any);
      expect(!!plan, `plan builds for: "${q.slice(0, 40)}"`);
      expect(
        plan.execution.kind !== 'run_computer_task' && plan.execution.kind !== 'run_browser_plan',
        `novice question never launches automation: "${q.slice(0, 40)}" (got ${plan.execution.kind})`,
      );
      const route = analyzeMessageRouting(q, 'main_chat').route;
      const explanation = explainAutoModelChoice(
        'sr-engineer', null, route?.intent, route?.complexity, undefined, undefined,
        PROVIDERS, { appGroundedHint: looksLikeAppGroundedMessage(q) },
      );
      expect(!!explanation.model && explanation.model !== 'auto', `auto resolves a concrete model for: "${q.slice(0, 40)}"`);
      expect(explanation.reason.length > 0 && explanation.reason.length <= 60, `reason is short + present for: "${q.slice(0, 40)}"`);
      expect(
        explanation.model === resolveModelForSoul('sr-engineer', null as any, route?.intent, route?.complexity, undefined, undefined, PROVIDERS, { appGroundedHint: looksLikeAppGroundedMessage(q) }),
        `preview matches send for: "${q.slice(0, 40)}"`,
      );
    }
    // The app-domain question lands on the app-trained model.
    expect(looksLikeAppGroundedMessage('what is my circle streak?'), 'streak question detected as app-domain');
    pass('orientation questions: safe routing + explained auto model');
  }

  // ── Battery 2: discoverability — partial typing surfaces the new features ──
  {
    const watchMatches = getMatchingChatSlashCommands('/wat');
    expect(watchMatches.some((c) => c.command === '/watch'), 'typing /wat surfaces /watch in the palette');
    const raceMatches = getMatchingChatSlashCommands('/best');
    expect(raceMatches.some((c) => c.command === '/bestof'), 'typing /best surfaces /bestof');
    const keywordMatches = getMatchingChatSlashCommands('/race');
    expect(keywordMatches.some((c) => c.command === '/bestof'), 'keyword "race" finds /bestof');
    expect(!!getChatCommandByCommand('/watch') && !!getChatCommandByCommand('/bestof'), 'both commands registered');
    pass('discoverability: palette surfaces watch + bestof for a novice');
  }

  // ── Battery 3: novice watch lifecycle in plain words ────────────────────────
  {
    const store: any[] = [];
    const deps = {
      list: async () => store,
      create: async (input: any) => {
        const row = { id: `w${store.length + 1}`, active: true, next_run_at: new Date(Date.now() + 3600_000).toISOString(), notify_on: input.notifyOn, cadence: input.cadence, task: input.task };
        store.push(row);
        return { ok: true as const, schedule: row };
      },
      setActive: async (id: string, active: boolean) => {
        const row = store.find((r) => r.id === id);
        if (row) row.active = active;
        return !!row;
      },
    };
    const floor = (task: string) => detectAlwaysConfirmFloorCategories(task);
    const created = await executeWatchCommand(
      '/watch daily check amazon for the price of a 4-slice toaster under $40',
      { circleId: 'c1', userId: 'u1', threadId: 't1', floorCategoriesFor: floor, deps },
    );
    expect(!!created && created.success, 'novice watch creates in plain words');
    expect(!!created && /every day/i.test(created.message), 'confirmation says how often in plain words');

    const listed = await executeWatchCommand('/watch list', { circleId: 'c1', userId: 'u1', floorCategoriesFor: floor, deps });
    expect(!!listed && listed.success && listed.message.includes('toaster'), '/watch list shows the watch');

    const stopped = await executeWatchCommand('/watch stop 1', { circleId: 'c1', userId: 'u1', floorCategoriesFor: floor, deps });
    expect(!!stopped && stopped.success, '/watch stop 1 works by number');

    // Safety: a novice asking the watch to BUY must be refused in plain words.
    const buying = await executeWatchCommand(
      '/watch daily buy the toaster if it drops below $20',
      { circleId: 'c1', userId: 'u1', floorCategoriesFor: floor, deps },
    );
    expect(!!buying && !buying.success, 'watch that would purchase is refused');
    expect(!!buying && /read-only/i.test(buying.message), 'refusal explains watches are read-only');
    pass('watch lifecycle: create/list/stop + purchase refusal, all plain-word');
  }

  // ── Battery 4: typos never swallow messages ────────────────────────────────
  {
    expect(parseBestOfNCommand('/bestofn sonnet,gpt hello') === null, 'typo /bestofn falls through (never swallowed)');
    expect(parseBestOfNCommand('tell me about /bestof') === null, 'mid-sentence mention is not a command');
    const typoPlan = buildChatAutomationPlan({ message: '/wtch daily check the news', surface: 'main_chat' } as any);
    expect(!!typoPlan, 'typo /wtch still yields a plan (no crash)');
    pass('typos: parse fall-through contracts hold');
  }

  // ── Battery 5: best-of race, novice topic, judged winner ───────────────────
  {
    const parsed = parseBestOfNCommand('/bestof sonnet,blackswan explain agentic AI to someone my age in two paragraphs');
    expect(!!parsed && parsed.ok === true, 'novice bestof parses');
    if (parsed && parsed.ok) {
      const models = resolveRaceModels(parsed.models, PROVIDERS);
      expect(models.includes('huggingface_endpoint/cswan801/BlackSwan-v5'), 'blackswan alias resolves to the v5 endpoint');
      const result = await runBestOfNRace(
        { models, task: parsed.task, circleId: 'c1', userId: 'u1' },
        {
          invoke: async (model: string) => model.includes('BlackSwan')
            ? { ok: true, text: 'Agentic AI means the assistant can take real steps for you, like checking a website — with your approval for anything important.' }
            : { ok: true, text: JSON.stringify({ winnerIndex: 0, reasons: 'clearer for a newcomer', scores: [{ model: models[0], score: 9, note: 'plain' }, { model: models[1], score: 7, note: 'ok' }] }) },
        } as any,
      );
      expect(!!result.formattedReport && result.formattedReport.includes('Winner'), 'race report names a winner');
      expect(result.formattedReport.includes('no tools'), 'report carries the text-only safety note');
    }
    pass('best-of race: novice-friendly end to end');
  }

  // ── Battery 6: nothing nags, and blocked states speak plainly ──────────────
  {
    const idle = buildChatAttentionState({});
    expect(idle.statusLine === null, 'no pending anything → no nagging strip');
    const withApproval = buildChatAttentionState({
      approvals: [{ id: 'a1', action_type: 'chat.run_computer_task', description: 'Approve browser check', status: 'pending', requested_at: new Date().toISOString(), timeout_seconds: 900 }],
    });
    expect(!!withApproval.statusLine && withApproval.statusLine.startsWith('Needs you:'), 'pending approval → plain "Needs you" line');

    const bridge = translateChatFailure('Desktop bridge offline — connection refused');
    expect(!!bridge && !/ECONN|refused/.test(bridge.summary), 'bridge failure summary has no jargon');
    const missingKey = providerBlockerFromFailure('key_missing: add your own OpenAI API key');
    expect(!!missingKey && /Marketplace/.test(missingKey.reason), 'missing key points at Marketplace in plain words');
    pass('attention + errors: quiet by default, plain when blocked');
  }

  // ── Battery 7: novice chat never gets a surprise room handoff ──────────────
  {
    const chitchat = [
      { content: 'I watched a video about AI agents last night', isBot: false },
      { content: 'That sounds fun! Want me to show you around?', isBot: true },
      { content: 'yes please, where do I start?', isBot: false },
      { content: 'Try asking me to check a website for you.', isBot: true },
    ];
    expect(detectRoomHandoffSuggestion(chitchat) === null, 'chitchat never suggests a project room');
    pass('room handoff: conservative for non-project chat');
  }

  // ── Battery 8: "make me things" — /create routes novice briefs sensibly ────
  {
    const { parseCreateCommand, buildCreateDirective, classifyCreateIntent } = await import('../src/lib/createChatCommand');
    const menu = buildCreateDirective('');
    expect(menu.action.kind === 'reply' && /webpage/i.test(menu.action.message) && /spreadsheet/i.test(menu.action.message), 'bare /create shows a helpful menu');
    expect(classifyCreateIntent('a landing page for my bakery') === 'webpage', 'bakery landing page → webpage');
    expect(classifyCreateIntent('a spreadsheet of my monthly bills') === 'spreadsheet', 'monthly bills → spreadsheet');
    expect(classifyCreateIntent('a resume for a nurse with 20 years experience') === 'document', 'resume → document');
    const deck = buildCreateDirective('a slide deck about our Q3 goals');
    expect(deck.action.kind === 'resend_as' && deck.action.message.startsWith('/build-page ') && /slide/i.test(deck.action.message),
      'presentations build a real HTML deck via /build-page');
    expect(/pptx not supported/i.test(deck.note), 'deck note stays honest that .pptx is not supported');
    expect(parseCreateCommand('/created something') === null, '/created typo falls through');
    pass('/create: novice briefs route to real pipelines, honesty for gaps');
  }

  // ── Battery 9: /review is safe + parseable for a novice ────────────────────
  {
    const { parseReviewCommand, detectGithubPrUrl } = await import('../src/lib/reviewChatCommand');
    const parsed = parseReviewCommand('/review https://github.com/acme/site/pull/42 focus on security');
    expect(!!parsed && parsed.ok === true && parsed.target.kind === 'pr_url', 'pasted PR URL parses');
    expect(!!parsed && parsed.ok === true && /security/.test(parsed.focus || ''), 'focus request captured');
    expect(parseReviewCommand('/reviewx whatever') === null, '/reviewx falls through');
    expect(detectGithubPrUrl('check https://github.com/acme/site/pull/7 when you can')?.number === 7, 'PR URL detected mid-sentence');
    expect(detectGithubPrUrl('my site is example.com/pull/3') === null, 'lookalike URLs rejected');
    pass('/review: parse contracts hold for novice input');
  }

  if (failures > 0) {
    console.error(`\n${failures} novice persona smoke failure(s)`);
    process.exit(1);
  }
  console.log('\nAll novice persona smoke cases passed.');
}

void main();
