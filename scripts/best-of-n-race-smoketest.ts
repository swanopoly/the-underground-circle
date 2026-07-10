/**
 * best-of-n-race-smoketest — verifies the `/bestof` race-and-judge module
 * (Cursor's Best-of-N pattern for chat): parse grammar (null fall-through,
 * both spellings, missing task, <2 models, >4 clamped after dedupe), alias
 * resolution (sonnet/haiku/opus/gpt/blackswan/auto + verbatim passthrough),
 * parallel racing (all candidates invoked, failures captured not thrown),
 * judged winner + report contents (header, safety note, candidate lines,
 * scores, winner line, winner text), judge-garbage → fastest-successful
 * fallback, the zero-success failure report, and summarizeBestOfNRace's
 * bounded compact projection (persist/adopt-card seam).
 *
 * Runs against an injected fake invoke — no supabase, no react-native, no
 * network. Candidates and judge are scripted per-model.
 *
 * Run: npx tsx scripts/best-of-n-race-smoketest.ts
 */

import {
  BEST_OF_N_MAX_CANDIDATES,
  parseBestOfNCommand,
  resolveRaceModels,
  runBestOfNRace,
  summarizeBestOfNRace,
  type BestOfNDeps,
} from '../src/lib/bestOfNRace';
import { BLACKSWAN_ENDPOINT_MODEL_ID } from '../src/lib/blackswanRouting';
import { resolveModelForSoul } from '../src/lib/serviceProfileSouls';

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

// ── Fake invoke harness (the deps test seam) ────────────────────────────────

interface ScriptedModel {
  /** ok:true response text. */
  text?: string;
  /** ok:false with this error (captured, not thrown). */
  error?: string;
  /** Reject the invoke promise with this message (per-candidate try/catch). */
  throws?: string;
  /** Microtask yields before resolving — more yields = slower candidate. */
  yields?: number;
}

interface InvokeCall {
  model: string;
  prompt: string;
  circleId: string;
  userId: string;
}

function makeRaceHarness(options: {
  script: Record<string, ScriptedModel>;
  /** Any model NOT in `script` is treated as the judge. */
  judge?: (prompt: string) => { ok: boolean; text: string; error?: string };
}) {
  let tick = 0;
  const now = () => {
    tick += 1;
    return tick;
  };
  const invoked: InvokeCall[] = [];

  const invoke: BestOfNDeps['invoke'] = async (model, prompt, opts) => {
    invoked.push({ model, prompt, circleId: opts.circleId, userId: opts.userId });
    const spec = options.script[model];
    if (!spec) {
      if (options.judge) return options.judge(prompt);
      return { ok: false, text: '', error: `unscripted model: ${model}` };
    }
    const yields = spec.yields ?? 1;
    for (let i = 0; i < yields; i += 1) await Promise.resolve();
    if (spec.throws) throw new Error(spec.throws);
    if (spec.error) return { ok: false, text: '', error: spec.error };
    return { ok: true, text: spec.text ?? `answer from ${model}` };
  };

  const judgeCalls = () => invoked.filter((call) => !(call.model in options.script));
  return { invoke, now, invoked, judgeCalls };
}

const RACE_INPUT_BASE = { circleId: 'circle-1', userId: 'user-1' };

// ── Cases ───────────────────────────────────────────────────────────────────

async function main() {
  // Parse: non-command input falls through as null
  {
    expect(parseBestOfNCommand('hello there') === null, 'plain chat → null');
    expect(parseBestOfNCommand('/watch daily check x') === null, 'other slash command → null');
    expect(parseBestOfNCommand('/bestofmax a,b task') === null, '/bestofmax (no token boundary) → null');
    expect(parseBestOfNCommand('/best-of-nothing a,b task') === null, '/best-of-nothing → null');
    expect(parseBestOfNCommand('') === null, 'empty input → null');
    expect(parseBestOfNCommand('   ') === null, 'whitespace input → null');
    pass('parse: non-command input → null');
  }

  // Parse: both spellings, models resolved, task preserved
  {
    // P12: parse returns RAW tokens (caller re-resolves with the live
    // connected-provider set so `auto` gets BYOK bias); resolveRaceModels
    // owns alias mapping and is asserted separately below.
    const short = parseBestOfNCommand('/bestof sonnet,gpt write a haiku about deploy queues');
    expect(!!short && short.ok === true, '/bestof parses');
    if (short && short.ok) {
      expect(
        short.models.length === 2 && short.models[0] === 'sonnet' && short.models[1] === 'gpt',
        'model list returned raw, in order',
      );
      expect(
        resolveRaceModels(short.models).join('|') === 'claude-sonnet-4-6|gpt-5.5',
        'caller-side resolution maps the raw tokens',
      );
      expect(short.task === 'write a haiku about deploy queues', 'task preserved verbatim');
    }
    const long = parseBestOfNCommand('/best-of-n haiku,opus summarize the roadmap');
    expect(!!long && long.ok === true, '/best-of-n parses');
    if (long && long.ok) {
      expect(
        long.models[0] === 'haiku' && long.models[1] === 'opus',
        'haiku/opus returned raw for caller-side resolution',
      );
      expect(long.task === 'summarize the roadmap', '/best-of-n task preserved');
    }
    const mixedCase = parseBestOfNCommand('/BestOf sonnet,gpt compare the options');
    expect(!!mixedCase && mixedCase.ok === true, 'command is case-insensitive');
    pass('parse: both spellings + alias-resolved models');
  }

  // Parse: missing task / bare command → usage error
  {
    const noTask = parseBestOfNCommand('/bestof sonnet,gpt');
    expect(!!noTask && noTask.ok === false, 'missing task → ok:false');
    expect(!!noTask && !noTask.ok && /task/i.test(noTask.error), 'missing-task error mentions the task');
    expect(!!noTask && !noTask.ok && /usage/i.test(noTask.error), 'missing-task error carries usage text');
    const bare = parseBestOfNCommand('/bestof');
    expect(!!bare && bare.ok === false, 'bare /bestof → ok:false');
    expect(!!bare && !bare.ok && /usage/i.test(bare.error), 'bare command carries usage text');
    pass('parse: missing task → usage error');
  }

  // Parse: single model rejected
  {
    const single = parseBestOfNCommand('/bestof sonnet write a haiku');
    expect(!!single && single.ok === false, 'single model → ok:false');
    expect(!!single && !single.ok && /2/.test(single.error), 'single-model error mentions the 2-model minimum');
    const collapsed = parseBestOfNCommand('/bestof sonnet,claude-sonnet-4-6 write a haiku');
    expect(!!collapsed && collapsed.ok === false, 'two entries collapsing to one model → ok:false');
    expect(!!collapsed && !collapsed.ok && /distinct/i.test(collapsed.error), 'collapse error asks for distinct models');
    pass('parse: <2 models rejected');
  }

  // Parse: >4 entries clamped after dedupe
  {
    const result = parseBestOfNCommand('/bestof sonnet,sonnet,m-1,m-2,m-3,m-4 do the thing');
    expect(!!result && result.ok === true, '6 raw entries still parse');
    if (result && result.ok) {
      // Raw list passes through; the clamp/dedupe happens at caller-side
      // resolution (P12 raw-token contract).
      const resolved = resolveRaceModels(result.models);
      expect(resolved.length === BEST_OF_N_MAX_CANDIDATES, `resolution clamps to ${BEST_OF_N_MAX_CANDIDATES}`);
      expect(
        resolved.join('|') === 'claude-sonnet-4-6|m-1|m-2|m-3',
        'dupes removed BEFORE the cap (duplicate sonnet does not burn a slot; m-4 dropped)',
      );
      expect(result.task === 'do the thing', 'task survives the clamp');
    }
    pass('parse: >4 clamped after dedupe (at resolution)');
  }

  // Alias resolution: sonnet/blackswan/gpt + auto + verbatim passthrough
  {
    const resolved = resolveRaceModels(['sonnet', 'blackswan', 'gpt']);
    expect(resolved[0] === 'claude-sonnet-4-6', 'sonnet → claude-sonnet-4-6');
    expect(resolved[1] === BLACKSWAN_ENDPOINT_MODEL_ID, 'blackswan → BLACKSWAN_ENDPOINT_MODEL_ID');
    expect(
      BLACKSWAN_ENDPOINT_MODEL_ID.startsWith('huggingface_endpoint/'),
      'blackswan resolves to the dedicated endpoint id',
    );
    expect(resolved[2] === 'gpt-5.5', 'gpt → gpt-5.5');

    const autoDefault = resolveRaceModels(['auto', 'openrouter/deepseek/deepseek-chat-v3']);
    expect(
      autoDefault[0] ===
        resolveModelForSoul('sr-engineer', 'auto', undefined, undefined, false, false, undefined),
      'auto → resolveModelForSoul(sr-engineer, auto, …) with no providers',
    );
    expect(autoDefault[1] === 'openrouter/deepseek/deepseek-chat-v3', 'unknown ids pass through verbatim');

    const providers: ReadonlySet<string> = new Set(['groq']);
    const autoBiased = resolveRaceModels(['auto'], providers);
    expect(
      autoBiased[0] ===
        resolveModelForSoul('sr-engineer', 'auto', undefined, undefined, false, false, providers),
      'auto honors connectedProviders bias',
    );

    expect(resolveRaceModels(['SONNET'])[0] === 'claude-sonnet-4-6', 'aliases are case-insensitive');
    expect(resolveRaceModels(['MyOrg/Model-X'])[0] === 'MyOrg/Model-X', 'passthrough keeps original casing');

    const deduped = resolveRaceModels(['gpt', 'sonnet', 'gpt', 'haiku', 'opus', 'blackswan']);
    expect(
      deduped.join('|') === 'gpt-5.5|claude-sonnet-4-6|claude-haiku-4-5|claude-opus-4-8',
      'dedupe preserves order, cap trims the tail',
    );
    expect(resolveRaceModels([' sonnet ', '', '  '])[0] === 'claude-sonnet-4-6', 'entries trimmed, empties dropped');
    pass('alias resolution: aliases, auto, passthrough, dedupe+cap');
  }

  // Parallel race + judged winner + report contents
  {
    const task = 'Compare our three deploy strategies and recommend one with evidence. ' + 'x'.repeat(60);
    const harness = makeRaceHarness({
      script: {
        'model-a': { text: 'Alpha answer: pick blue/green.', yields: 1 },
        'model-b': { text: 'Bravo answer: canary, because rollout evidence shows lower MTTR.', yields: 2 },
        'model-c': { error: 'boom: provider down', yields: 1 },
      },
      judge: () => ({
        ok: true,
        text:
          'Here is my verdict:\n```json\n{"winnerIndex": 1, "reasons": "Bravo is the most complete and cites evidence.", ' +
          '"scores": [{"model": "model-a", "score": 6, "note": "thin"}, {"model": "model-b", "score": 9, "note": "complete"}]}\n```\nDone.',
      }),
    });

    const result = await runBestOfNRace(
      { models: ['model-a', 'model-b', 'model-c'], task, judgeModel: 'judge-1', ...RACE_INPUT_BASE },
      { invoke: harness.invoke, now: harness.now },
    );

    // All candidates invoked, in parallel, with the raw task + context.
    const candidateCalls = harness.invoked.filter((call) => call.model in { 'model-a': 1, 'model-b': 1, 'model-c': 1 });
    expect(candidateCalls.length === 3, 'every candidate model invoked exactly once');
    expect(
      candidateCalls.every((call) => call.prompt === task && call.circleId === 'circle-1' && call.userId === 'user-1'),
      'candidates get the raw task + circle/user context',
    );
    expect(result.prompt === task, 'result.prompt is the raced task');
    expect(result.candidates.length === 3, 'one candidate result per model');
    expect(result.candidates[2].ok === false && result.candidates[2].error === 'boom: provider down',
      'failure captured as ok:false with its error, not thrown');
    expect(result.candidates.every((candidate) => candidate.durationMs >= 0), 'durations measured via injected now');

    // Judge: called once with a rubric over ONLY the successful candidates.
    const judgeCalls = harness.judgeCalls();
    expect(judgeCalls.length === 1 && judgeCalls[0].model === 'judge-1', 'judge invoked once with judgeModel');
    const rubric = judgeCalls[0].prompt;
    expect(rubric.includes('Candidate 0') && rubric.includes('Candidate 1'), 'rubric numbers the successful candidates');
    expect(!rubric.includes('Candidate 2'), 'failed candidate excluded from the rubric');
    expect(rubric.includes('Bravo answer') && rubric.includes('Alpha answer'), 'rubric carries candidate texts');
    expect(/STRICT JSON/.test(rubric), 'rubric demands strict JSON');
    expect(/correctness/.test(rubric) && /completeness/.test(rubric) && /evidence/.test(rubric) && /brevity/.test(rubric),
      'rubric judges on correctness/completeness/evidence/brevity');

    // Judgement parsed from fenced JSON; winner mapped by original index.
    expect(!!result.judgement && result.judgement.winnerIndex === 1, 'judgement parsed from fenced JSON, winnerIndex 1');
    expect(!!result.judgement && result.judgement.scores.length === 2 && result.judgement.scores[1].score === 9,
      'scores parsed with models + numbers');
    expect(!!result.winner && result.winner.model === 'model-b', 'winner is candidates[winnerIndex]');

    // Report: header + safety note + candidate lines + scores + winner line + winner text.
    const report = result.formattedReport;
    expect(report.startsWith('🏁 Best-of-3: "'), 'report header names the race size');
    expect(!report.includes('x'.repeat(60)), 'header task clamped to 80 chars');
    expect(report.includes('…'), 'clamped task marked with ellipsis');
    expect(/text-only/i.test(report) && /no tools/i.test(report) && /never executes/i.test(report),
      'safety note: text-only, no tools, judge never executes');
    expect(report.includes('1. `model-a` · ✅ ok ·'), 'per-candidate line: model + ok + duration');
    expect(report.includes('score 6') && report.includes('score 9'), 'per-candidate lines carry judge scores');
    expect(/3\. `model-c` · ❌ failed .*boom: provider down/.test(report), 'failed line explains its error');
    expect(report.includes('**Winner: model-b** — Bravo is the most complete and cites evidence.'),
      'winner line: bold model + judge reasons');
    expect(report.includes('Bravo answer: canary, because rollout evidence shows lower MTTR.'),
      'winner full text included');
    pass('parallel race + judged winner + report contents');
  }

  // Throwing invoker is captured per-candidate (race never crashes)
  {
    const harness = makeRaceHarness({
      script: {
        'model-ok': { text: 'still standing', yields: 1 },
        'model-x': { throws: 'network exploded', yields: 1 },
      },
    });
    const result = await runBestOfNRace(
      { models: ['model-ok', 'model-x'], task: 'stay alive', judgeModel: 'judge-1', ...RACE_INPUT_BASE },
      { invoke: harness.invoke, now: harness.now },
    );
    expect(result.candidates[1].ok === false && result.candidates[1].error === 'network exploded',
      'thrown invoker error captured as ok:false');
    expect(!!result.winner && result.winner.model === 'model-ok', 'surviving candidate wins');
    expect(result.judgement === null, 'single success → no judgement');
    expect(harness.judgeCalls().length === 0, 'single success → judge never invoked');
    expect(/no judging needed/i.test(result.formattedReport), 'report notes the default win');
    pass('throwing invoker captured, not fatal');
  }

  // Judge garbage → fastest successful candidate wins, judgement null, noted
  {
    const harness = makeRaceHarness({
      script: {
        'model-slow': { text: 'slow but fine', yields: 4 },
        'model-fast': { text: 'fast and fine', yields: 1 },
      },
      judge: () => ({ ok: true, text: 'I refuse to answer in JSON. The best one is nice.' }),
    });
    const result = await runBestOfNRace(
      { models: ['model-slow', 'model-fast'], task: 'race the clock', judgeModel: 'judge-1', ...RACE_INPUT_BASE },
      { invoke: harness.invoke, now: harness.now },
    );
    expect(harness.judgeCalls().length === 1, 'judge was consulted');
    expect(result.judgement === null, 'garbage judge → judgement null');
    const slow = result.candidates[0];
    const fast = result.candidates[1];
    expect(fast.durationMs < slow.durationMs, 'injected now produced distinct durations');
    expect(!!result.winner && result.winner.model === 'model-fast', 'fallback winner = fastest successful');
    expect(/fastest successful/i.test(result.formattedReport) && /could not be parsed/i.test(result.formattedReport),
      'report notes the judge-parse fallback');
    expect(result.formattedReport.includes('**Winner: model-fast**'), 'winner line still present');
    pass('judge-garbage → fastest-successful fallback');
  }

  // Judge picks an invalid/failed index → same fallback path
  {
    const harness = makeRaceHarness({
      script: {
        'model-a': { text: 'A', yields: 1 },
        'model-b': { text: 'B', yields: 2 },
        'model-dead': { error: 'down', yields: 1 },
      },
      judge: () => ({ ok: true, text: '{"winnerIndex": 2, "reasons": "I pick the dead one.", "scores": []}' }),
    });
    const result = await runBestOfNRace(
      { models: ['model-a', 'model-b', 'model-dead'], task: 'judge safely', judgeModel: 'judge-1', ...RACE_INPUT_BASE },
      { invoke: harness.invoke, now: harness.now },
    );
    expect(result.judgement === null, 'winnerIndex at a failed candidate → judgement rejected');
    expect(!!result.winner && result.winner.ok === true, 'fallback winner is a successful candidate');
    expect(!!result.winner && result.winner.model === 'model-a', 'fastest successful candidate chosen');
    pass('judge pointing at a failed candidate → fallback');
  }

  // Zero successes → judgement null, winner null, report explains all failures
  {
    const harness = makeRaceHarness({
      script: {
        'model-a': { error: 'rate limited (429)', yields: 1 },
        'model-b': { throws: 'socket hang up', yields: 1 },
      },
    });
    const result = await runBestOfNRace(
      { models: ['model-a', 'model-b'], task: 'doomed run', judgeModel: 'judge-1', ...RACE_INPUT_BASE },
      { invoke: harness.invoke, now: harness.now },
    );
    expect(result.judgement === null && result.winner === null, 'zero successes → judgement null, winner null');
    expect(harness.judgeCalls().length === 0, 'no judge call when nothing succeeded');
    const report = result.formattedReport;
    expect(report.startsWith('🏁 Best-of-2: "doomed run"'), 'failure report keeps the header');
    expect(/No winner/i.test(report), 'report says there is no winner');
    expect(report.includes('rate limited (429)') && report.includes('socket hang up'),
      'report explains every failure');
    expect(report.includes('❌ failed') && !report.includes('✅ ok'), 'all candidate lines marked failed');
    pass('zero-success report explains all failures');
  }

  // Default judge model is claude-sonnet-4-6 when judgeModel is omitted
  {
    const harness = makeRaceHarness({
      script: {
        'model-a': { text: 'A', yields: 1 },
        'model-b': { text: 'B', yields: 1 },
      },
      judge: () => ({ ok: true, text: '{"winnerIndex": 0, "reasons": "A wins.", "scores": [{"model": "model-a", "score": 8, "note": "solid"}]}' }),
    });
    const result = await runBestOfNRace(
      { models: ['model-a', 'model-b'], task: 'default judge', ...RACE_INPUT_BASE },
      { invoke: harness.invoke, now: harness.now },
    );
    const judgeCalls = harness.judgeCalls();
    expect(judgeCalls.length === 1 && judgeCalls[0].model === 'claude-sonnet-4-6',
      'omitted judgeModel defaults to claude-sonnet-4-6');
    expect(!!result.winner && result.winner.model === 'model-a', 'judged winner honored');
    pass('default judge model');
  }

  // summarizeBestOfNRace: bounded compact projection (persist/adopt-card seam)
  {
    const task = `Pick the best migration plan with evidence ${'y'.repeat(200)}`; // > 160 chars
    const bigText = `Bravo answer: canary rollout. ${'evidence '.repeat(400)}`; // > 1500 chars
    const harness = makeRaceHarness({
      script: {
        'model-a': { text: 'Alpha answer: blue/green.', yields: 1 },
        'model-b': { text: bigText, yields: 2 },
        'model-c': { error: 'boom: provider down', yields: 1 },
      },
      judge: () => ({
        ok: true,
        text:
          `{"winnerIndex": 1, "reasons": "Bravo cites evidence.", "scores": [` +
          `{"model": "model-a", "score": 6, "note": "${'thin '.repeat(60)}"}, ` +
          `{"model": "model-b", "score": 9, "note": "complete"}]}`,
      }),
    });
    const result = await runBestOfNRace(
      { models: ['model-a', 'model-b', 'model-c'], task, judgeModel: 'judge-1', ...RACE_INPUT_BASE },
      { invoke: harness.invoke, now: harness.now },
    );
    const summary = summarizeBestOfNRace(result);
    expect(summary.task.length <= 160, 'summary task clamped to 160');
    expect(summary.task.startsWith('Pick the best migration plan'), 'summary task keeps the head of the prompt');
    expect(summary.judged === true && summary.winnerIndex === 1, 'summary carries the judged winnerIndex');
    expect(summary.candidates.length === 3, 'summary keeps one entry per raced candidate');
    expect(summary.candidates[0].score === 6 && summary.candidates[1].score === 9, 'summary scores come from the judgement');
    expect(summary.candidates[0].note.length <= 120, 'summary judge notes clamped to 120');
    expect(summary.candidates[1].text.length <= 1500, 'summary candidate text clamped to 1500');
    expect(summary.candidates[1].text.startsWith('Bravo answer'), 'summary text preserves the answer head (adoptable)');
    expect(summary.candidates[2].ok === false && summary.candidates[2].score === null, 'failed candidate: ok false, score null');
    expect(summary.candidates[2].note.includes('boom'), 'failed candidate note carries its error');
    expect(summary.candidates.every((candidate) => candidate.durationMs >= 0), 'summary durations preserved');
    pass('summarizeBestOfNRace: bounded judged projection');
  }

  // summarizeBestOfNRace: unjudged fallback + no-winner cases
  {
    const harness = makeRaceHarness({
      script: {
        'model-slow': { text: 'slow but fine', yields: 4 },
        'model-fast': { text: 'fast and fine', yields: 1 },
      },
      judge: () => ({ ok: true, text: 'I refuse to answer in JSON.' }),
    });
    const result = await runBestOfNRace(
      { models: ['model-slow', 'model-fast'], task: 'race the clock', judgeModel: 'judge-1', ...RACE_INPUT_BASE },
      { invoke: harness.invoke, now: harness.now },
    );
    const summary = summarizeBestOfNRace(result);
    expect(summary.judged === false, 'unjudged race → judged false');
    expect(summary.winnerIndex === 1, 'winnerIndex falls back to the winner position (fastest successful)');
    expect(summary.candidates.every((candidate) => candidate.score === null), 'no judgement → all scores null');

    const emptySummary = summarizeBestOfNRace({
      prompt: 'doomed run',
      candidates: [{ model: 'model-x', ok: false, text: '', error: 'down', durationMs: 5 }],
      judgement: null,
      winner: null,
      formattedReport: '',
    });
    expect(emptySummary.winnerIndex === null, 'no winner → winnerIndex null');
    expect(emptySummary.judged === false, 'no winner → judged false');
    expect(emptySummary.candidates[0].note === 'down', 'failed-only race keeps the error note');
    pass('summarizeBestOfNRace: fallback winnerIndex + null when nothing won');
  }

  if (failures > 0) {
    console.error(`\n${failures} best-of-n race smoke failure(s)`);
    process.exit(1);
  }

  console.log('\nAll best-of-n race smoke cases passed.');
}

main().catch((error) => {
  console.error('best-of-n-race smoke crashed:', error);
  process.exit(1);
});
