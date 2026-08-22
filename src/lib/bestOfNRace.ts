/**
 * bestOfNRace — Cursor's verified `/best-of-n` pattern ("runs the same task
 * across multiple models at once… winner picked", automated Multi-Agent
 * Judging — see docs/BLACKSWAN_COMPOSER_PATTERN.md) mapped onto chat:
 * race N models on ONE prompt in parallel, have a judge model score the
 * answers, and present the winner plus a bounded comparison report.
 *
 * Grammar:
 *   /bestof model1,model2[,model3,model4] <task…>
 *   /best-of-n model1,model2[,model3,model4] <task…>
 *
 * Model aliases: auto (soul router), sonnet, haiku, opus, gpt, blackswan.
 * Anything else passes through verbatim (provider-prefixed ids welcome).
 *
 * SAFETY: race candidates are TEXT-ONLY generations — no tools, no side
 * effects, no computer use. This is a comparison surface; the judge reads
 * candidate text and never executes anything. Approval floors, evidence
 * contracts, and tool routing are untouched by this module.
 *
 * CRITICAL: top-level imports must stay pure — only `serviceProfileSouls`
 * and `blackswanRouting` (no supabase / react-native) so this module loads
 * under tsx for smoke tests. The real cross-provider invoker
 * (`universalInvoke.invokeAnyChat`) is reached lazily via `await import(...)`
 * inside `runBestOfNRace`, and only when the caller did not inject
 * `deps.invoke` (the smoke-test seam) — exactly like watchChatCommands does
 * for its CRUD. Production callers should prefer injecting an invoker wired
 * to the user's connected keys (e.g. via `useInvokeAnyChat`); the lazy
 * default runs `invokeAnyChat` with its built-in availability defaults.
 */

import { resolveModelForSoul } from './serviceProfileSouls';
import { BLACKSWAN_ENDPOINT_MODEL_ID } from './blackswanRouting';
import { reconcileParallelResults } from './parallelResultConsensusCore';

export const BEST_OF_N_MAX_CANDIDATES = 4;

export interface BestOfNCandidateResult {
  model: string;
  ok: boolean;
  text: string;
  error?: string;
  durationMs: number;
}

export interface BestOfNJudgement {
  /** Index into `BestOfNRaceResult.candidates` (original race order). */
  winnerIndex: number;
  reasons: string;
  scores: Array<{ model: string; score: number; note: string }>;
}

export interface BestOfNRaceResult {
  prompt: string;
  candidates: BestOfNCandidateResult[];
  judgement: BestOfNJudgement | null;
  winner: BestOfNCandidateResult | null;
  formattedReport: string;
}

export interface BestOfNDeps {
  /** Text-in/text-out model call. Injected by smoke tests and by callers
   *  that already hold a keys-aware invoker; defaults to universalInvoke. */
  invoke: (
    model: string,
    prompt: string,
    opts: { circleId: string; userId: string },
  ) => Promise<{ ok: boolean; text: string; error?: string }>;
  now?: () => number;
}

const DEFAULT_JUDGE_MODEL = 'claude-sonnet-4-6';

/** Bounds — keep chat rows and judge prompts small (CLAUDE.md: bounded payloads). */
const TASK_HEADER_BOUND = 80;
const CANDIDATE_JUDGE_TEXT_BOUND = 2000;
const REASONS_REPORT_BOUND = 300;
const WINNER_TEXT_BOUND = 4000;
const ERROR_LINE_BOUND = 200;
const JUDGEMENT_REASONS_BOUND = 1000;
const JUDGEMENT_NOTE_BOUND = 300;

const USAGE_TEXT =
  'Usage: `/bestof model1,model2[,model3,model4] <task>` — race 2–' +
  `${BEST_OF_N_MAX_CANDIDATES} models on one prompt in parallel, judge the answers, and report the winner. ` +
  'Aliases: `auto`, `sonnet`, `haiku`, `opus`, `gpt`, `blackswan`; other model ids pass through verbatim. ' +
  '`/best-of-n …` works too.';

/**
 * Parse a `/bestof` (or `/best-of-n`) chat command.
 *
 * Returns null when the input is not this command (fall through to the next
 * handler — house rule from watchChatCommands: the command must be a whole
 * token, so `/bestofmax …` is not ours). Returned `models` are already
 * alias-resolved, deduped, and capped via `resolveRaceModels` (no
 * connected-provider bias at parse time — callers holding the marketplace
 * set can re-run `resolveRaceModels` themselves before racing).
 */
export function parseBestOfNCommand(
  raw: string,
): { ok: true; models: string[]; task: string } | { ok: false; error: string } | null {
  const trimmed = String(raw || '').trim();
  if (!trimmed) return null;

  const match = trimmed.match(/^\/(?:best-of-n|bestof)(?:\s+([\s\S]*))?$/i);
  if (!match) return null;

  const rest = (match[1] || '').trim();
  if (!rest) {
    return { ok: false, error: `Which models, and what task? ${USAGE_TEXT}` };
  }

  // First whitespace-delimited token is the comma-separated model list;
  // everything after it is the task.
  const firstBreak = rest.search(/\s/);
  const modelList = firstBreak === -1 ? rest : rest.slice(0, firstBreak);
  const task = firstBreak === -1 ? '' : rest.slice(firstBreak).trim();

  const rawModels = modelList
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);

  if (rawModels.length < 2) {
    return {
      ok: false,
      error: `A race needs at least 2 models (comma-separated, no spaces in the list). ${USAGE_TEXT}`,
    };
  }
  if (!task) {
    return { ok: false, error: `Missing task — what should the models race on? ${USAGE_TEXT}` };
  }

  // Only reject literal duplicates here. Alias resolution and dedupe require
  // the caller's exact live Marketplace catalog: for example `auto,sonnet`
  // may be two distinct connected providers even when a provider-less soul
  // resolver would collapse them both to Claude.
  const distinctRawModels = new Set(rawModels.map((model) => model.toLowerCase()));
  if (distinctRawModels.size < 2) {
    return {
      ok: false,
      error: `Those entries resolve to the same model — pick at least 2 distinct models. ${USAGE_TEXT}`,
    };
  }

  return { ok: true, models: rawModels, task };
}

/**
 * Resolve race-list aliases to concrete model ids: `auto` goes through the
 * soul router (optionally biased by the connected marketplace providers),
 * short names map to the current frontier ids, `blackswan` maps to the
 * dedicated HF endpoint, and anything else passes through verbatim.
 * Dedupes on the resolved id (order-preserving) and caps at
 * BEST_OF_N_MAX_CANDIDATES.
 */
export function resolveRaceModels(
  models: string[],
  connectedProviders?: ReadonlySet<string>,
): string[] {
  const resolved: string[] = [];
  const seen = new Set<string>();

  for (const raw of models) {
    const entry = String(raw ?? '').trim();
    if (!entry) continue;

    let model: string;
    switch (entry.toLowerCase()) {
      case 'auto':
        model = resolveModelForSoul(
          'sr-engineer',
          'auto',
          undefined,
          undefined,
          /* buildConverging */ false,
          /* buildExploring */ false,
          connectedProviders,
        );
        break;
      case 'sonnet':
        model = 'claude-sonnet-4-6';
        break;
      case 'haiku':
        model = 'claude-haiku-4-5';
        break;
      case 'opus':
        model = 'claude-opus-4-8';
        break;
      case 'gpt':
        model = 'gpt-5.5';
        break;
      case 'blackswan':
        model = BLACKSWAN_ENDPOINT_MODEL_ID;
        break;
      default:
        model = entry;
    }

    const dedupeKey = model.toLowerCase();
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    resolved.push(model);
    if (resolved.length >= BEST_OF_N_MAX_CANDIDATES) break;
  }

  return resolved;
}

/**
 * Race the models on one prompt in parallel, judge the successful answers,
 * and return winner + judgement + a bounded markdown report.
 *
 * - Candidates run via Promise.allSettled with a per-candidate try/catch,
 *   so one throwing invoker never sinks the race — it becomes ok:false.
 * - Zero successes → judgement null, winner null, report explains failures.
 * - One success → it wins by default (judgement null, noted in the report).
 * - Judge output is parsed tolerantly (first balanced {...} block); an
 *   unusable judge falls back to the fastest successful candidate with
 *   judgement null and a note in the report.
 */
export async function runBestOfNRace(
  input: {
    models: string[];
    task: string;
    circleId: string;
    userId: string;
    /** Text-only judge; defaults to 'claude-sonnet-4-6'. */
    judgeModel?: string;
  },
  deps?: BestOfNDeps,
): Promise<BestOfNRaceResult> {
  const now = deps?.now ?? Date.now;
  const invoke = deps?.invoke ?? (await loadDefaultInvoke());
  const task = String(input.task ?? '').trim();
  const opts = { circleId: input.circleId, userId: input.userId };

  const models = input.models
    .map((model) => String(model ?? '').trim())
    .filter(Boolean)
    .slice(0, BEST_OF_N_MAX_CANDIDATES);

  // ── Race: all candidates in parallel ──────────────────────────────────────
  const raceOne = async (model: string): Promise<BestOfNCandidateResult> => {
    const startedAt = now();
    try {
      const result = await invoke(model, task, opts);
      const durationMs = Math.max(0, now() - startedAt);
      if (result && result.ok === true) {
        return { model, ok: true, text: String(result.text ?? ''), durationMs };
      }
      return {
        model,
        ok: false,
        text: '',
        error: String(result?.error || 'Model returned no usable response.'),
        durationMs,
      };
    } catch (error) {
      return {
        model,
        ok: false,
        text: '',
        error: errorMessage(error),
        durationMs: Math.max(0, now() - startedAt),
      };
    }
  };

  const settled = await Promise.allSettled(models.map(raceOne));
  const candidates: BestOfNCandidateResult[] = settled.map((outcome, index) =>
    outcome.status === 'fulfilled'
      ? outcome.value
      : { model: models[index], ok: false, text: '', error: errorMessage(outcome.reason), durationMs: 0 },
  );

  const successes = candidates.filter((candidate) => candidate.ok);

  // ── Zero successes: nothing to judge, nothing to present ──────────────────
  if (successes.length === 0) {
    return {
      prompt: task,
      candidates,
      judgement: null,
      winner: null,
      formattedReport: buildReport({ task, candidates, judgement: null, winner: null, judgeNote: null }),
    };
  }

  // ── One success: default winner, no judge call needed ─────────────────────
  if (successes.length === 1) {
    const winner = successes[0];
    return {
      prompt: task,
      candidates,
      judgement: null,
      winner,
      formattedReport: buildReport({
        task,
        candidates,
        judgement: null,
        winner,
        judgeNote: 'only candidate to succeed — no judging needed',
      }),
    };
  }

  // ── Consensus short-circuit: if the successful candidates already agree
  // (deterministic majority vote — no model call), skip the paid judge and
  // return the agreed answer. Only fires on a clear 'accept'; plurality/tie
  // fall through to the judge and split/none fall through to escalate, both
  // preserving the existing judge path unchanged. winnerIndex is an original
  // index into `candidates`, exactly like `candidates[judgement.winnerIndex]`.
  const consensus = reconcileParallelResults(candidates);
  if (consensus.recommendedAction === 'accept' && consensus.winnerIndex !== null) {
    const winner = candidates[consensus.winnerIndex];
    return {
      prompt: task,
      candidates,
      judgement: null,
      winner,
      formattedReport: buildReport({
        task,
        candidates,
        judgement: null,
        winner,
        judgeNote: `consensus: ${consensus.votedCount} candidates agreed — no judge needed`,
      }),
    };
  }

  // ── Judge: rubric prompt over the successful candidates ───────────────────
  const judgeModel = String(input.judgeModel || DEFAULT_JUDGE_MODEL);
  let judgement: BestOfNJudgement | null = null;
  let judgeNote: string | null = null;
  try {
    const judgeResult = await invoke(judgeModel, buildJudgePrompt(task, candidates), opts);
    if (judgeResult && judgeResult.ok === true) {
      judgement = parseJudgement(judgeResult.text, candidates);
      if (!judgement) {
        judgeNote = 'fastest successful candidate — the judge reply could not be parsed as JSON';
      }
    } else {
      judgeNote = `fastest successful candidate — the judge call failed (${clampInline(String(judgeResult?.error || 'no response'), ERROR_LINE_BOUND)})`;
    }
  } catch (error) {
    judgeNote = `fastest successful candidate — the judge call failed (${clampInline(errorMessage(error), ERROR_LINE_BOUND)})`;
  }

  const winner = judgement
    ? candidates[judgement.winnerIndex]
    : fastestSuccessful(successes);

  return {
    prompt: task,
    candidates,
    judgement,
    winner,
    formattedReport: buildReport({ task, candidates, judgement, winner, judgeNote }),
  };
}

// ─── Compact projection (persist / adopt-card seam) ──────────────────────────

/** Bounds for the compact race summary — small enough to persist on the chat
 *  row (CLAUDE.md: bounded payloads), big enough that adopting a candidate's
 *  text as the reply still makes sense. Mirrored by `PersistedBestOfNRace` in
 *  persistedChatMetadata.ts. */
const SUMMARY_TASK_BOUND = 160;
const SUMMARY_NOTE_BOUND = 120;
const SUMMARY_TEXT_BOUND = 1500;

export interface BestOfNCandidateSummary {
  model: string;
  ok: boolean;
  /** Judge score for this candidate, or null when unjudged/failed. */
  score: number | null;
  /** Judge note for scored candidates; the error line for failed ones. */
  note: string;
  durationMs: number;
  /** Bounded answer text — enough to adopt as the reply. */
  text: string;
}

export interface BestOfNRaceSummary {
  task: string;
  /** Index into `candidates`, or null when nothing won. */
  winnerIndex: number | null;
  judged: boolean;
  candidates: BestOfNCandidateSummary[];
}

/**
 * Project a race result into the compact interactive summary used by the
 * adopt card and persisted chat metadata (`bestOfNMetadata` in
 * persistedChatMetadata.ts). Bounds: task ≤160, per-candidate note ≤120 and
 * text ≤1500, at most BEST_OF_N_MAX_CANDIDATES candidates. Scores come from
 * the judgement when present (null otherwise); winnerIndex prefers the
 * judgement, then falls back to the position of `winner` in the candidates,
 * then null.
 */
export function summarizeBestOfNRace(result: BestOfNRaceResult): BestOfNRaceSummary {
  const raced = (result.candidates || []).slice(0, BEST_OF_N_MAX_CANDIDATES);
  const judgement = result.judgement ?? null;

  const candidates: BestOfNCandidateSummary[] = raced.map((candidate) => {
    const scoreEntry = judgement?.scores.find((entry) => entry.model === candidate.model);
    const note = scoreEntry?.note
      ? scoreEntry.note
      : !candidate.ok && candidate.error
        ? candidate.error
        : '';
    return {
      model: String(candidate.model ?? ''),
      ok: candidate.ok === true,
      score: candidate.ok && scoreEntry && Number.isFinite(scoreEntry.score) ? scoreEntry.score : null,
      note: clampInline(note, SUMMARY_NOTE_BOUND),
      durationMs: Number.isFinite(candidate.durationMs) ? Math.max(0, Math.round(candidate.durationMs)) : 0,
      text: clampBlock(candidate.text || '', SUMMARY_TEXT_BOUND),
    };
  });

  let winnerIndex: number | null = null;
  if (
    judgement &&
    Number.isInteger(judgement.winnerIndex) &&
    judgement.winnerIndex >= 0 &&
    judgement.winnerIndex < candidates.length
  ) {
    winnerIndex = judgement.winnerIndex;
  } else if (result.winner) {
    const position = (result.candidates || []).indexOf(result.winner);
    winnerIndex = position >= 0 && position < candidates.length ? position : null;
  }

  return {
    task: clampInline(result.prompt || '', SUMMARY_TASK_BOUND),
    winnerIndex,
    judged: !!judgement,
    candidates,
  };
}

// ─── Internals ───────────────────────────────────────────────────────────────

/**
 * Lazy default invoker — resolves the unified cross-provider entry only when
 * the caller did not inject one, keeping supabase/react-native out of this
 * module's load path (the smoke-test seam, same shape as watchChatCommands).
 */
async function loadDefaultInvoke(): Promise<BestOfNDeps['invoke']> {
  const { invokeAnyChat } = await import('./universalInvoke');
  return async (model, prompt, opts) => {
    try {
      const result = await invokeAnyChat({
        modelId: model,
        messages: [{ role: 'user', content: prompt }],
        circleId: opts.circleId,
      });
      return { ok: true, text: result.response };
    } catch (error) {
      return { ok: false, text: '', error: errorMessage(error) };
    }
  };
}

/** Fastest successful candidate; ties keep the earlier (race-order) one. */
function fastestSuccessful(successes: BestOfNCandidateResult[]): BestOfNCandidateResult {
  return successes.reduce((best, candidate) =>
    candidate.durationMs < best.durationMs ? candidate : best,
  );
}

/**
 * Rubric prompt for the judge. Failed candidates are excluded; each listed
 * candidate keeps its ORIGINAL race index so the judge's winnerIndex maps
 * straight into `candidates`. Candidate texts and the task are clamped so
 * the judge prompt stays bounded. The judge only reads and scores text —
 * it must never be given tools.
 */
function buildJudgePrompt(task: string, candidates: BestOfNCandidateResult[]): string {
  const judged = candidates
    .map((candidate, index) => ({ candidate, index }))
    .filter(({ candidate }) => candidate.ok);

  const validIndexes = judged.map(({ index }) => index).join(', ');
  const blocks = judged.map(({ candidate, index }) =>
    [
      `Candidate ${index} — model: ${candidate.model}`,
      clampBlock(candidate.text || '(empty response)', CANDIDATE_JUDGE_TEXT_BOUND),
    ].join('\n'),
  );

  return [
    'You are the judge of a best-of-N model race. Each candidate model answered the same task independently. Pick the single best answer.',
    '',
    'Task:',
    clampBlock(task, CANDIDATE_JUDGE_TEXT_BOUND),
    '',
    'Candidates (numbers are fixed candidate indexes — do not renumber):',
    '',
    blocks.join('\n\n'),
    '',
    'Judge on: correctness, completeness, evidence, and brevity.',
    'Respond with STRICT JSON only — no prose, no markdown fences — exactly this shape:',
    '{"winnerIndex": <number>, "reasons": "<one short paragraph>", "scores": [{"model": "<model id>", "score": <0-10>, "note": "<short note>"}]}',
    `winnerIndex MUST be one of: ${validIndexes}. Include one scores entry per candidate listed above.`,
  ].join('\n');
}

/**
 * Tolerant judgement parse: extract the first balanced {...} block from the
 * judge text, JSON.parse it, then validate winnerIndex points at a
 * successful candidate. Anything off → null (caller falls back to the
 * fastest successful candidate).
 */
function parseJudgement(
  rawText: string,
  candidates: BestOfNCandidateResult[],
): BestOfNJudgement | null {
  const parsed = extractFirstJsonObject(rawText);
  if (!parsed) return null;

  const winnerIndex = toInteger(parsed.winnerIndex);
  if (
    winnerIndex === null ||
    winnerIndex < 0 ||
    winnerIndex >= candidates.length ||
    !candidates[winnerIndex]?.ok
  ) {
    return null;
  }

  const reasons = clampInline(String((parsed.reasons as unknown) ?? ''), JUDGEMENT_REASONS_BOUND);

  const rawScores = Array.isArray(parsed.scores) ? parsed.scores : [];
  const scores = rawScores
    .filter((entry): entry is Record<string, unknown> => !!entry && typeof entry === 'object')
    .slice(0, BEST_OF_N_MAX_CANDIDATES)
    .map((entry) => ({
      model: String(entry.model ?? ''),
      score: Number.isFinite(Number(entry.score)) ? Number(entry.score) : 0,
      note: clampInline(String(entry.note ?? ''), JUDGEMENT_NOTE_BOUND),
    }));

  return { winnerIndex, reasons, scores };
}

/** First balanced top-level {...} block (string/escape aware), parsed as an object. */
function extractFirstJsonObject(text: string): Record<string, unknown> | null {
  const raw = String(text ?? '');
  const start = raw.indexOf('{');
  if (start < 0) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < raw.length; i += 1) {
    const ch = raw[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
    } else if (ch === '{') {
      depth += 1;
    } else if (ch === '}') {
      depth -= 1;
      if (depth === 0) {
        try {
          const parsed = JSON.parse(raw.slice(start, i + 1));
          return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
            ? (parsed as Record<string, unknown>)
            : null;
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

function toInteger(value: unknown): number | null {
  if (typeof value === 'number' && Number.isInteger(value)) return value;
  if (typeof value === 'string' && /^\d+$/.test(value.trim())) return Number.parseInt(value.trim(), 10);
  return null;
}

/** Bounded markdown comparison report — the only user-visible artifact. */
function buildReport(args: {
  task: string;
  candidates: BestOfNCandidateResult[];
  judgement: BestOfNJudgement | null;
  winner: BestOfNCandidateResult | null;
  /** Why the winner was picked without a judgement (fallbacks), or null. */
  judgeNote: string | null;
}): string {
  const { task, candidates, judgement, winner, judgeNote } = args;

  const lines: string[] = [
    `🏁 Best-of-${candidates.length}: "${clampInline(task, TASK_HEADER_BOUND)}"`,
    '_Safety: candidates are text-only generations — no tools, no side effects. This is a comparison surface; the judge never executes anything._',
    '',
  ];

  candidates.forEach((candidate, index) => {
    const score = judgement?.scores.find((entry) => entry.model === candidate.model);
    const parts = [
      `${index + 1}. \`${candidate.model}\``,
      candidate.ok ? '✅ ok' : '❌ failed',
      `${candidate.durationMs}ms`,
    ];
    if (candidate.ok && score) parts.push(`score ${score.score}`);
    let line = parts.join(' · ');
    if (!candidate.ok && candidate.error) {
      line += ` — ${clampInline(candidate.error, ERROR_LINE_BOUND)}`;
    }
    lines.push(line);
  });

  lines.push('');

  if (!winner) {
    lines.push(`**No winner** — all ${candidates.length} candidate(s) failed. See the errors above.`);
    return lines.join('\n');
  }

  const winnerWhy = judgement
    ? judgement.reasons || 'judge picked it on correctness/completeness/evidence/brevity'
    : judgeNote || 'no judgement available';
  lines.push(`**Winner: ${winner.model}** — ${clampInline(winnerWhy, REASONS_REPORT_BOUND)}`);
  lines.push('');
  lines.push(clampBlock(winner.text || '(empty response)', WINNER_TEXT_BOUND));

  return lines.join('\n');
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error ?? 'unknown error');
}

/** Single-line clamp — collapses whitespace so headers/notes stay one line. */
function clampInline(text: string, max: number): string {
  const collapsed = String(text ?? '').replace(/\s+/g, ' ').trim();
  if (collapsed.length <= max) return collapsed;
  return collapsed.slice(0, Math.max(0, max - 1)).trimEnd() + '…';
}

/** Block clamp — preserves newlines, caps total length. */
function clampBlock(text: string, max: number): string {
  const trimmed = String(text ?? '').trim();
  if (trimmed.length <= max) return trimmed;
  return trimmed.slice(0, Math.max(0, max - 1)).trimEnd() + '…';
}
