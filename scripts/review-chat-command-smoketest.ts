/**
 * review-chat-command-smoketest — verifies the `/review` chat command module:
 * parse grammar (null fall-through incl. '/reviewx', latest default, #123 and
 * bare-number forms, PR URL + trailing focus text, garbage target → usage
 * error), detectGithubPrUrl (positive / negative / mid-sentence),
 * buildReviewPrompt (severity emojis, pass order correctness→security→design→
 * style, untrusted fence wrapping the diff, 45k clamp with truncation note,
 * focus line, file table rows), and executeReviewCommand (happy path via URL,
 * latest-pr resolution through injected listPrs, no-connection → Marketplace
 * pointer, fetch failure surfaced plainly, invoke failure, bounded message,
 * non-command → null).
 *
 * Also covers the `--comment` opt-in (capability-map gap #5): parse-level
 * flag detection/stripping (any position, `--comments` lookalike rejected,
 * default false), execute-level HITL approval filing through the injected
 * `fileApproval` seam (action_type `chat.review_comment`, owner/repo/number/
 * body/prUrl payload, 8k body clamp, 3600s window, approval note appended;
 * failed reviews and unresolvable targets file NOTHING; filing failures
 * surface without sinking the review), and the approval worker's payload
 * contract. NOTE: agentApprovalsWorker has no smoke of its own and imports
 * supabase → react-native, so it cannot load under tsx — its exported
 * `applyApprovedReviewCommentAction` handler delegates validation + body
 * composition to the pure reviewChatCommand exports tested directly here
 * (validateReviewCommentApprovalPayload / composeReviewCommentBody).
 *
 * Runs against injected deps — no supabase, no react-native, no network.
 *
 * Run: npx tsx scripts/review-chat-command-smoketest.ts
 */

import { readFileSync } from 'node:fs';
import {
  buildReviewPrompt,
  composeReviewCommentBody,
  detectGithubPrUrl,
  executeReviewCommand,
  parseReviewCommand,
  validateReviewCommentApprovalPayload,
  REVIEW_COMMENT_ACTION_TYPE,
  REVIEW_COMMENT_ATTRIBUTION,
  REVIEW_COMMENT_BODY_BOUND,
  type ReviewDeps,
  type ReviewPrFile,
  type ReviewPrRef,
} from '../src/lib/reviewChatCommand';
import { UNTRUSTED_OPEN, UNTRUSTED_CLOSE } from '../src/lib/untrustedContent';
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

// ── Fake deps harness (the ReviewDeps test seam) ────────────────────────────

const CTX = { circleId: 'circle-1', userId: 'user-1' };
const approvalWorkerSource = readFileSync(
  new URL('../src/lib/agentApprovalsWorker.ts', import.meta.url),
  'utf8',
);

const FAKE_FILES: ReviewPrFile[] = [
  { filename: 'src/engine.ts', status: 'modified', additions: 10, deletions: 2 },
  { filename: 'src/booster.ts', status: 'added', additions: 55, deletions: 0 },
];

const DIFF_SENTINEL = 'const thrust = computeThrust(payload); // DIFF_SENTINEL_LINE';
const FAKE_DIFF = [
  'diff --git a/src/engine.ts b/src/engine.ts',
  '--- a/src/engine.ts',
  '+++ b/src/engine.ts',
  '@@ -1,4 +1,6 @@',
  `+${DIFF_SENTINEL}`,
].join('\n');

const DEFAULT_PRS: ReviewPrRef[] = [
  { number: 42, title: 'Fix rocket boosters', html_url: 'https://github.com/acme/rocket/pull/42' },
];

/** What executeReviewCommand hands the fileApproval seam (the --comment gate). */
type FiledApproval = Parameters<NonNullable<ReviewDeps['fileApproval']>>[0];

interface HarnessOptions {
  /** undefined → default acme/rocket connection; null → no connection resolved. */
  connection?: { token: string; repo: { owner: string; repo: string } | null } | null;
  connectionError?: string;
  prs?: ReviewPrRef[];
  listPrsError?: string;
  diff?: string;
  diffError?: string;
  files?: ReviewPrFile[];
  filesError?: string;
  invokeText?: string;
  invokeError?: string;
  fileApprovalError?: string;
}

function makeHarness(options: HarnessOptions = {}) {
  const calls = {
    invoked: [] as Array<{ model: string; prompt: string; circleId: string; userId: string }>,
    listPrs: [] as string[],
    fetchDiff: [] as string[],
    fetchFiles: [] as string[],
    filedApprovals: [] as FiledApproval[],
  };

  const deps: ReviewDeps = {
    resolveConnection: async () => {
      if (options.connectionError) return { error: options.connectionError };
      if (options.connection === null) return {};
      return {
        connection: options.connection ?? { token: 'tok-1', repo: { owner: 'acme', repo: 'rocket' } },
      };
    },
    listPrs: async (owner, repo, token) => {
      calls.listPrs.push(`${owner}/${repo}:${token}`);
      if (options.listPrsError) return { prs: [], error: options.listPrsError };
      return { prs: options.prs ?? DEFAULT_PRS };
    },
    fetchDiff: async (owner, repo, pullNumber, token) => {
      calls.fetchDiff.push(`${owner}/${repo}#${pullNumber}:${token}`);
      if (options.diffError) return { error: options.diffError };
      return { diff: options.diff ?? FAKE_DIFF };
    },
    fetchFiles: async (owner, repo, pullNumber, token) => {
      calls.fetchFiles.push(`${owner}/${repo}#${pullNumber}:${token}`);
      if (options.filesError) return { error: options.filesError };
      return { files: options.files ?? FAKE_FILES };
    },
    invoke: async (model, prompt, opts) => {
      calls.invoked.push({ model, prompt, circleId: opts.circleId, userId: opts.userId });
      if (options.invokeError) return { ok: false, text: '', error: options.invokeError };
      return { ok: true, text: options.invokeText ?? 'REVIEW_BODY: 🔴 Blocker — src/engine.ts:3 unchecked thrust.' };
    },
    fileApproval: async (input) => {
      calls.filedApprovals.push(input);
      if (options.fileApprovalError) return { ok: false, error: options.fileApprovalError };
      return { ok: true };
    },
  };

  return { deps, calls };
}

function expectedReviewModel(): string {
  try {
    return (
      resolveModelForSoul('code-reviewer', null, 'review', 'complex', undefined, undefined, undefined) ||
      'claude-sonnet-4-6'
    );
  } catch {
    return 'claude-sonnet-4-6';
  }
}

// ── Cases ───────────────────────────────────────────────────────────────────

async function main() {
  // Parse: non-command input falls through as null
  {
    expect(parseReviewCommand('hello there') === null, 'plain chat → null');
    expect(parseReviewCommand('/reviewx 123') === null, "'/reviewx' (no token boundary) → null");
    expect(parseReviewCommand('/reviews latest') === null, "'/reviews' → null");
    expect(parseReviewCommand('/gh prs') === null, 'other slash command → null');
    expect(parseReviewCommand('please /review this') === null, 'must START with /review → null');
    expect(parseReviewCommand('') === null, 'empty input → null');
    expect(parseReviewCommand('   ') === null, 'whitespace input → null');
    pass('parse: non-command input → null');
  }

  // Parse: bare `/review` and `/review latest` → latest_pr
  {
    const bare = parseReviewCommand('/review');
    expect(!!bare && bare.ok === true && bare.target.kind === 'latest_pr' && bare.focus === null,
      'bare /review → latest_pr, no focus');
    const trailing = parseReviewCommand('  /review   ');
    expect(!!trailing && trailing.ok === true && trailing.target.kind === 'latest_pr',
      'surrounding whitespace tolerated');
    const latest = parseReviewCommand('/review latest');
    expect(!!latest && latest.ok === true && latest.target.kind === 'latest_pr' && latest.focus === null,
      '/review latest → latest_pr');
    const focused = parseReviewCommand('/review LATEST focus on error handling');
    expect(!!focused && focused.ok === true && focused.target.kind === 'latest_pr',
      'latest keyword is case-insensitive');
    expect(!!focused && focused.ok === true && focused.focus === 'focus on error handling',
      'trailing free text after latest captured as focus');
    pass('parse: latest default + focus capture');
  }

  // Parse: #123 and bare-number forms
  {
    const hash = parseReviewCommand('/review #123');
    expect(
      !!hash && hash.ok === true && hash.target.kind === 'pr_number' && hash.target.number === 123 && hash.focus === null,
      '/review #123 → pr_number 123',
    );
    const bareNumber = parseReviewCommand('/review 123');
    expect(
      !!bareNumber && bareNumber.ok === true && bareNumber.target.kind === 'pr_number' && bareNumber.target.number === 123,
      '/review 123 (bare number) → pr_number 123',
    );
    const withFocus = parseReviewCommand('/review #123 focus on security');
    expect(
      !!withFocus && withFocus.ok === true && withFocus.target.kind === 'pr_number' && withFocus.focus === 'focus on security',
      'trailing free text after #123 captured as focus',
    );
    pass('parse: PR-number forms');
  }

  // Parse: PR URL forms (incl. trailing text → focus)
  {
    const plain = parseReviewCommand('/review https://github.com/acme/rocket/pull/42');
    expect(
      !!plain && plain.ok === true && plain.target.kind === 'pr_url' &&
        plain.target.owner === 'acme' && plain.target.repo === 'rocket' && plain.target.number === 42 &&
        plain.focus === null,
      'https PR URL → pr_url {acme, rocket, 42}',
    );
    const schemeless = parseReviewCommand('/review github.com/acme/rocket/pull/42 check auth handling');
    expect(
      !!schemeless && schemeless.ok === true && schemeless.target.kind === 'pr_url' && schemeless.target.number === 42,
      'schemeless PR URL accepted',
    );
    expect(!!schemeless && schemeless.ok === true && schemeless.focus === 'check auth handling',
      'trailing free text after the URL captured as focus');
    const suffixed = parseReviewCommand('/review https://github.com/acme/rocket/pull/42/files?diff=split deep dive');
    expect(
      !!suffixed && suffixed.ok === true && suffixed.target.kind === 'pr_url' && suffixed.target.number === 42 &&
        suffixed.focus === 'deep dive',
      'URL with /files?… suffix still resolves the PR number; suffix text stays out of focus',
    );
    pass('parse: PR URL forms + focus');
  }

  // Parse: present-but-unparseable target → usage error
  {
    const garbage = parseReviewCommand('/review that thing from yesterday');
    expect(!!garbage && garbage.ok === false, 'garbage target → ok:false');
    expect(!!garbage && !garbage.ok && /usage/i.test(garbage.error), 'garbage-target error carries usage text');
    const notNumber = parseReviewCommand('/review #abc');
    expect(!!notNumber && notNumber.ok === false, '#abc → ok:false');
    const zero = parseReviewCommand('/review 0');
    expect(!!zero && zero.ok === false, 'PR #0 rejected (PR numbers start at 1)');
    const issuesUrl = parseReviewCommand('/review https://github.com/acme/rocket/issues/42');
    expect(!!issuesUrl && issuesUrl.ok === false, 'issues URL is not a PR target → ok:false');
    expect(!!issuesUrl && !issuesUrl.ok && /usage/i.test(issuesUrl.error), 'issues-URL error carries usage text');
    pass('parse: unparseable target → usage error');
  }

  // Parse: `--comment` flag (gap #5) — detected, stripped from focus, default false
  {
    const plain = parseReviewCommand('/review #5');
    expect(!!plain && plain.ok === true && plain.wantsComment === false,
      'wantsComment defaults to false without the flag');

    const flagged = parseReviewCommand('/review #5 --comment');
    expect(!!flagged && flagged.ok === true && flagged.wantsComment === true,
      '/review #5 --comment → wantsComment true');
    expect(!!flagged && flagged.ok === true && flagged.target.kind === 'pr_number' &&
      flagged.target.number === 5 && flagged.focus === null,
      'flag alone: target intact, focus stays null (flag stripped)');

    const before = parseReviewCommand('/review #5 --comment focus on auth');
    expect(!!before && before.ok === true && before.wantsComment === true && before.focus === 'focus on auth',
      'flag BEFORE focus text: detected + stripped from focus');

    const after = parseReviewCommand('/review #5 focus on auth --comment');
    expect(!!after && after.ok === true && after.wantsComment === true && after.focus === 'focus on auth',
      'flag AFTER focus text: detected + stripped from focus');

    const url = parseReviewCommand('/review https://github.com/acme/rocket/pull/42 --comment check auth');
    expect(!!url && url.ok === true && url.target.kind === 'pr_url' && url.target.number === 42 &&
      url.wantsComment === true && url.focus === 'check auth',
      'flag works with URL targets, focus survives without it');

    const latest = parseReviewCommand('/review latest --comment');
    expect(!!latest && latest.ok === true && latest.target.kind === 'latest_pr' && latest.wantsComment === true,
      'flag works with latest');

    const bare = parseReviewCommand('/review --comment');
    expect(!!bare && bare.ok === true && bare.target.kind === 'latest_pr' &&
      bare.focus === null && bare.wantsComment === true,
      'bare /review --comment → latest_pr + wantsComment');

    const upper = parseReviewCommand('/review #5 --COMMENT');
    expect(!!upper && upper.ok === true && upper.wantsComment === true,
      'flag is case-insensitive (matches latest keyword forgiveness)');

    const lookalike = parseReviewCommand('/review #5 --comments please');
    expect(!!lookalike && lookalike.ok === true && lookalike.wantsComment === false &&
      lookalike.focus === '--comments please',
      "'--comments' (longer token) is NOT the flag and stays in focus");

    const word = parseReviewCommand('/review #5 comment on style');
    expect(!!word && word.ok === true && word.wantsComment === false && word.focus === 'comment on style',
      "bare word 'comment' is NOT the flag");
    pass('parse: --comment flag detection + stripping');
  }

  // detectGithubPrUrl: positive, negative, mid-sentence
  {
    const bare = detectGithubPrUrl('github.com/a/b/pull/7');
    expect(!!bare && bare.owner === 'a' && bare.repo === 'b' && bare.number === 7, 'schemeless URL detected');
    const full = detectGithubPrUrl('https://www.github.com/Acme-Org/my.repo/pull/108');
    expect(
      !!full && full.owner === 'Acme-Org' && full.repo === 'my.repo' && full.number === 108,
      'https+www URL with dotted/hyphenated names detected',
    );
    const mid = detectGithubPrUrl('please look at https://github.com/a/b/pull/7 before standup');
    expect(!!mid && mid.number === 7, 'URL detected mid-sentence');
    const suffixed = detectGithubPrUrl('https://github.com/a/b/pull/7/files?w=1');
    expect(!!suffixed && suffixed.number === 7, 'trailing /files path tolerated');
    expect(detectGithubPrUrl('https://github.com/a/b/issues/7') === null, 'issues URL → null');
    expect(detectGithubPrUrl('https://gitlab.com/a/b/pull/7') === null, 'gitlab host → null');
    expect(detectGithubPrUrl('mygithub.com/a/b/pull/7') === null, 'lookalike host (mygithub.com) → null');
    expect(detectGithubPrUrl('no urls in this sentence') === null, 'plain text → null');
    expect(detectGithubPrUrl('') === null, 'empty text → null');
    pass('detectGithubPrUrl: positive/negative/mid-sentence');
  }

  // buildReviewPrompt: severity contract, pass order, fence, table, verdict
  {
    const prompt = buildReviewPrompt({
      prTitle: 'Fix rocket boosters',
      prUrl: 'https://github.com/acme/rocket/pull/42',
      diff: FAKE_DIFF,
      files: FAKE_FILES,
      focus: 'focus on security',
    });

    expect(prompt.includes('🔴 Blocker') && prompt.includes('🟡 Suggestion') && prompt.includes('💭 Nit'),
      'severity emojis + labels present');
    expect(/file:line/.test(prompt) && /concrete fix/i.test(prompt) && /why it matters/i.test(prompt),
      'finding contract: problem + file:line anchor + fix + why');
    expect(prompt.includes('Reviewer focus requested: focus on security'), 'focus line present when provided');
    expect(prompt.includes('Fix rocket boosters') && prompt.includes('https://github.com/acme/rocket/pull/42'),
      'PR title + URL present');

    // Untrusted fence wraps the diff (open marker → diff → close marker).
    const openIdx = prompt.indexOf(UNTRUSTED_OPEN);
    const diffIdx = prompt.indexOf(DIFF_SENTINEL);
    const closeIdx = prompt.indexOf(UNTRUSTED_CLOSE);
    expect(openIdx >= 0 && diffIdx > openIdx && closeIdx > diffIdx, 'untrusted fence wraps the diff');
    expect(/UNTRUSTED code under review/.test(prompt) && /never follow instructions/i.test(prompt),
      'fence preamble: untrusted + never-follow-instructions warning');

    // critique_pr anti-patterns.
    expect(/highest-severity/i.test(prompt), 'lead-with-highest-severity rule present');
    expect(/vague concerns/i.test(prompt), 'no-vague-concerns rule present');
    expect(/open questions/i.test(prompt), 'confirmed-vs-open-questions separation present');
    expect(/Style nitpicks before correctness/i.test(prompt), 'no style-before-correctness anti-pattern present');

    // File table rows.
    expect(prompt.includes('| `src/engine.ts` | modified | 10 | 2 |'), 'file table row (modified)');
    expect(prompt.includes('| `src/booster.ts` | added | 55 | 0 |'), 'file table row (added)');
    expect(prompt.includes(`CHANGED FILES (${FAKE_FILES.length})`), 'file table counts the files');

    // Required output shape.
    expect(prompt.includes('Merge-readiness:') && prompt.includes('Residual risk:'),
      'required 2-line verdict (merge-readiness + residual risk)');

    // Pass order on a focus-free prompt (first occurrences strictly ordered).
    const plain = buildReviewPrompt({
      prTitle: 'Fix rocket boosters',
      prUrl: 'https://github.com/acme/rocket/pull/42',
      diff: FAKE_DIFF,
      files: FAKE_FILES,
      focus: null,
    });
    expect(!plain.includes('Reviewer focus requested'), 'no focus line when focus is null');
    const lower = plain.toLowerCase();
    const correctnessIdx = lower.indexOf('correctness');
    const securityIdx = lower.indexOf('security');
    const designIdx = lower.indexOf('design');
    const styleIdx = lower.indexOf('style');
    expect(
      correctnessIdx >= 0 && securityIdx > correctnessIdx && designIdx > securityIdx && styleIdx > designIdx,
      'pass order: correctness → security → design → style',
    );
    pass('buildReviewPrompt: severity + passes + fence + table + verdict');
  }

  // buildReviewPrompt: 45k diff clamp with truncation note
  {
    const bigDiff = `${FAKE_DIFF}\n${'x'.repeat(50_000)}TAIL_MARKER_SHOULD_BE_GONE`;
    const prompt = buildReviewPrompt({
      prTitle: 'Big PR',
      prUrl: 'https://github.com/acme/rocket/pull/43',
      diff: bigDiff,
      files: [],
      focus: null,
    });
    expect(!prompt.includes('TAIL_MARKER_SHOULD_BE_GONE'), 'diff clamped — tail beyond 45k dropped');
    expect(prompt.includes(DIFF_SENTINEL), 'head of the diff kept');
    expect(/truncated/i.test(prompt) && prompt.includes('45,000'), 'truncation note names the 45k clamp');
    const small = buildReviewPrompt({
      prTitle: 'Small PR',
      prUrl: 'u',
      diff: FAKE_DIFF,
      files: [],
      focus: null,
    });
    expect(!/truncated at/i.test(small), 'no truncation note for small diffs');
    pass('buildReviewPrompt: 45k clamp + note');
  }

  // executeReviewCommand: happy path via PR URL (+ focus)
  {
    const { deps, calls } = makeHarness();
    const result = await executeReviewCommand(
      '/review https://github.com/acme/rocket/pull/42 focus on security',
      { ...CTX, deps },
    );
    expect(result !== null, 'command input → non-null result');
    expect(!!result && result.success === true, 'happy path succeeds');
    expect(!!result && result.message.startsWith('🔍 **Code review — '), 'report header shape');
    expect(!!result && result.message.includes('Fix rocket boosters') && result.message.includes('(#42)'),
      'header carries the PR title (via listPrs lookup) + number');
    expect(!!result && result.message.includes('https://github.com/acme/rocket/pull/42'), 'header carries the PR URL');
    expect(!!result && result.message.includes('REVIEW_BODY: 🔴 Blocker'), 'model review output included');

    expect(calls.invoked.length === 1, 'review model invoked exactly once');
    const call = calls.invoked[0];
    expect(call.prompt.includes(DIFF_SENTINEL), 'invoke received a prompt containing the diff');
    expect(call.prompt.includes('Reviewer focus requested: focus on security'), 'focus threaded into the prompt');
    expect(call.prompt.includes('| `src/engine.ts` | modified | 10 | 2 |'), 'fetched files threaded into the prompt');
    expect(call.circleId === 'circle-1' && call.userId === 'user-1', 'circle/user context passed to invoke');
    expect(call.model === expectedReviewModel(),
      "model = resolveModelForSoul('code-reviewer', …, review, complex) with sonnet fallback");
    expect(calls.fetchDiff[0] === 'acme/rocket#42:tok-1' && calls.fetchFiles[0] === 'acme/rocket#42:tok-1',
      'diff + files fetched for the URL repo with the resolved token');
    pass('execute: URL happy path');
  }

  // executeReviewCommand: pr_url works token-only (no connected repo needed)
  {
    const { deps, calls } = makeHarness({ connection: { token: 'tok-9', repo: null } });
    const result = await executeReviewCommand('/review github.com/other/lib/pull/7', { ...CTX, deps });
    expect(!!result && result.success === true, 'pr_url review works with token-only connection');
    expect(!!result && result.message.includes('(#7)'), 'header carries the URL PR number');
    expect(calls.fetchDiff[0] === 'other/lib#7:tok-9', 'fetches hit the URL owner/repo, not a connected repo');
    pass('execute: pr_url token-only');
  }

  // executeReviewCommand: latest-pr resolution via injected listPrs
  {
    const prs: ReviewPrRef[] = [
      { number: 57, title: 'Newest PR', html_url: 'https://github.com/acme/rocket/pull/57' },
      { number: 41, title: 'Older PR', html_url: 'https://github.com/acme/rocket/pull/41' },
    ];
    const { deps, calls } = makeHarness({ prs });
    const result = await executeReviewCommand('/review latest', { ...CTX, deps });
    expect(!!result && result.success === true, 'latest resolves and succeeds');
    expect(!!result && result.message.includes('Newest PR') && result.message.includes('(#57)'),
      'latest = first (most recently updated) open PR');
    expect(calls.listPrs.length === 1 && calls.listPrs[0] === 'acme/rocket:tok-1',
      'open PRs listed once against the connected repo');
    expect(calls.fetchDiff[0] === 'acme/rocket#57:tok-1', 'diff fetched for the resolved latest PR');

    const bare = await executeReviewCommand('/review', { ...CTX, deps: makeHarness().deps });
    expect(!!bare && bare.success === true && bare.message.includes('(#42)'), 'bare /review defaults to latest');

    const { deps: emptyDeps } = makeHarness({ prs: [] });
    const none = await executeReviewCommand('/review latest', { ...CTX, deps: emptyDeps });
    expect(!!none && none.success === false, 'zero open PRs → failure result');
    expect(!!none && /no open pull requests/i.test(none.message) && none.message.includes('acme/rocket'),
      'zero-open-PRs error is friendly and names the repo');
    pass('execute: latest-pr resolution');
  }

  // executeReviewCommand: no connection → Marketplace pointer
  {
    const { deps, calls } = makeHarness({ connection: null });
    const result = await executeReviewCommand('/review #5', { ...CTX, deps });
    expect(!!result && result.success === false, 'no connection → failure result');
    expect(!!result && /Marketplace/.test(result.message) && /GitHub/.test(result.message),
      'no-connection error points at Marketplace → GitHub');
    expect(calls.invoked.length === 0, 'no model call without a connection');

    const { deps: errDeps } = makeHarness({ connectionError: 'rls denied' });
    const errResult = await executeReviewCommand('/review #5', { ...CTX, deps: errDeps });
    expect(!!errResult && errResult.success === false && /Marketplace/.test(errResult.message),
      'connection-resolution error still yields the Marketplace pointer');

    const { deps: noRepoDeps } = makeHarness({ connection: { token: 'tok-1', repo: null } });
    const noRepo = await executeReviewCommand('/review #5', { ...CTX, deps: noRepoDeps });
    expect(!!noRepo && noRepo.success === false, 'number target without a connected repo → failure');
    expect(!!noRepo && /No GitHub repo is connected/.test(noRepo.message) && /Marketplace/.test(noRepo.message),
      'no-repo error names the fix (Marketplace → GitHub)');
    pass('execute: connection errors mention Marketplace');
  }

  // executeReviewCommand: fetch failures surface plainly
  {
    const { deps, calls } = makeHarness({ diffError: 'GitHub API rate limit exceeded for installation' });
    const result = await executeReviewCommand('/review #42', { ...CTX, deps });
    expect(!!result && result.success === false, 'diff fetch failure → failure result');
    expect(!!result && result.message.includes('GitHub API rate limit exceeded for installation'),
      'fetch error surfaced verbatim (plain language)');
    expect(!!result && result.message.includes('#42'), 'fetch error names the PR');
    expect(calls.invoked.length === 0, 'no model call when the diff is missing');

    const { deps: nfDeps } = makeHarness({ diffError: '{"message":"Not Found","documentation_url":"…"}' });
    const notFound = await executeReviewCommand('/review #999', { ...CTX, deps: nfDeps });
    expect(!!notFound && notFound.success === false && notFound.message.includes('PR #999 not found'),
      "missing PR → friendly 'PR #999 not found in owner/repo'");

    const { deps: filesDeps } = makeHarness({ filesError: 'files endpoint down' });
    const filesFail = await executeReviewCommand('/review #42', { ...CTX, deps: filesDeps });
    expect(!!filesFail && filesFail.success === false && filesFail.message.includes('files endpoint down'),
      'file-list fetch failure also surfaces plainly');
    pass('execute: fetch failures surface plainly');
  }

  // executeReviewCommand: invoke failure surfaces plainly
  {
    const { deps } = makeHarness({ invokeError: 'model exploded mid-flight' });
    const result = await executeReviewCommand('/review #42', { ...CTX, deps });
    expect(!!result && result.success === false, 'invoke failure → failure result');
    expect(!!result && /review model/i.test(result.message) && result.message.includes('model exploded mid-flight'),
      'invoke error named plainly with the failing model');
    pass('execute: invoke failure surfaced');
  }

  // executeReviewCommand: report stays bounded (~12k)
  {
    const { deps } = makeHarness({ invokeText: 'R'.repeat(20_000) });
    const result = await executeReviewCommand('/review #42', { ...CTX, deps });
    expect(!!result && result.success === true, 'oversized model output still succeeds');
    expect(!!result && result.message.length <= 12_000, 'report clamped to the 12k message bound');
    expect(!!result && result.message.startsWith('🔍 **Code review — '), 'header survives the clamp');
    pass('execute: bounded report');
  }

  // executeReviewCommand: non-command → null; parse error → usage message
  {
    const { deps } = makeHarness();
    expect((await executeReviewCommand('just chatting about PRs', { ...CTX, deps })) === null,
      'non-command → null (falls through to the next handler)');
    expect((await executeReviewCommand('/reviewx 5', { ...CTX, deps })) === null, "'/reviewx 5' → null");
    const bad = await executeReviewCommand('/review whatever man', { ...CTX, deps });
    expect(!!bad && bad.success === false && /usage/i.test(bad.message),
      'unparseable target → usage error via execute');
    pass('execute: non-command fall-through');
  }

  // executeReviewCommand: --comment happy path files a HITL approval (never posts)
  {
    const { deps, calls } = makeHarness();
    const result = await executeReviewCommand(
      '/review https://github.com/acme/rocket/pull/42 --comment',
      { ...CTX, deps },
    );
    expect(!!result && result.success === true, '--comment happy path succeeds');
    expect(!!result && result.message.includes('📝') && /needs approval/i.test(result.message),
      'message tells the user the post needs approval');
    expect(!!result && /banner above \(or Office\)/.test(result.message) &&
      /Nothing is posted until then/.test(result.message),
      'message points at the banner/Office and promises nothing posts before approval');

    expect(calls.filedApprovals.length === 1, 'exactly one approval filed');
    const filed = calls.filedApprovals[0];
    expect(filed.actionType === REVIEW_COMMENT_ACTION_TYPE && filed.actionType === 'chat.review_comment',
      "approval action_type = 'chat.review_comment'");
    expect(filed.payload.owner === 'acme' && filed.payload.repo === 'rocket' && filed.payload.number === 42,
      'payload carries the resolved owner/repo/number');
    expect(filed.payload.prUrl === 'https://github.com/acme/rocket/pull/42', 'payload carries the PR URL');
    expect(filed.payload.body.includes('REVIEW_BODY: 🔴 Blocker') &&
      filed.payload.body.includes('🔍 **Code review — '),
      'payload body contains the findings + report header');
    expect(!filed.payload.body.includes('needs approval'),
      'approval note is chat-only — it never rides into the PR comment body');
    expect(filed.description === 'Post code-review findings to acme/rocket#42',
      'description names the exact PR');
    expect(filed.timeoutSeconds === 3600, '1-hour approval window (longer than chat automations)');
    expect(filed.circleId === 'circle-1' && filed.userId === 'user-1', 'circle/user context threaded');
    pass('execute: --comment files approval with the right contract');
  }

  // executeReviewCommand: --comment payload body clamped to 8k
  {
    const { deps, calls } = makeHarness({ invokeText: 'R'.repeat(20_000) });
    const result = await executeReviewCommand('/review #42 --comment', { ...CTX, deps });
    expect(!!result && result.success === true, 'oversized review with --comment still succeeds');
    expect(calls.filedApprovals.length === 1 &&
      calls.filedApprovals[0].payload.body.length <= REVIEW_COMMENT_BODY_BOUND,
      `approval payload body clamped to ${REVIEW_COMMENT_BODY_BOUND} chars`);
    pass('execute: --comment body clamp');
  }

  // executeReviewCommand: read-only default — no flag, nothing filed
  {
    const { deps, calls } = makeHarness();
    const result = await executeReviewCommand('/review #42', { ...CTX, deps });
    expect(!!result && result.success === true && calls.filedApprovals.length === 0,
      'without --comment nothing is filed (read-only default)');
    expect(!!result && !/needs approval/i.test(result.message), 'no approval note without the flag');
    pass('execute: read-only default files nothing');
  }

  // executeReviewCommand: --comment with a FAILED review files nothing
  {
    const { deps, calls } = makeHarness({ invokeError: 'model exploded mid-flight' });
    const result = await executeReviewCommand('/review #42 --comment', { ...CTX, deps });
    expect(!!result && result.success === false, 'failed review with --comment → failure result');
    expect(calls.filedApprovals.length === 0, 'failed review files NO approval');
    expect(!!result && !/needs approval/i.test(result.message), 'no approval note on a failed review');

    const { deps: fetchDeps, calls: fetchCalls } = makeHarness({ diffError: 'rate limited' });
    const fetchFail = await executeReviewCommand('/review #42 --comment', { ...CTX, deps: fetchDeps });
    expect(!!fetchFail && fetchFail.success === false && fetchCalls.filedApprovals.length === 0,
      'diff-fetch failure with --comment also files nothing');
    pass('execute: failed review never files an approval');
  }

  // executeReviewCommand: --comment without a resolvable repo target files nothing
  {
    const { deps, calls } = makeHarness({ connection: { token: 'tok-1', repo: null } });
    const result = await executeReviewCommand('/review #5 --comment', { ...CTX, deps });
    expect(!!result && result.success === false && /No GitHub repo is connected/.test(result.message),
      'number target + --comment without a connected repo errors plainly');
    expect(calls.filedApprovals.length === 0, 'unresolvable repo target files NO approval');

    const { deps: noConnDeps, calls: noConnCalls } = makeHarness({ connection: null });
    const noConn = await executeReviewCommand('/review #5 --comment', { ...CTX, deps: noConnDeps });
    expect(!!noConn && noConn.success === false && /Marketplace/.test(noConn.message),
      'no connection + --comment errors plainly');
    expect(noConnCalls.filedApprovals.length === 0, 'no connection files NO approval');
    pass('execute: unresolvable target never files');
  }

  // executeReviewCommand: approval-filing failure surfaces without sinking the review
  {
    const { deps, calls } = makeHarness({ fileApprovalError: 'agent_approvals insert denied' });
    const result = await executeReviewCommand('/review #42 --comment', { ...CTX, deps });
    expect(!!result && result.success === true, 'review still succeeds when filing fails');
    expect(!!result && /Couldn't queue the PR comment/.test(result.message) &&
      result.message.includes('agent_approvals insert denied'),
      'filing failure surfaced plainly in the message');
    expect(!!result && /Nothing was posted to GitHub/.test(result.message),
      'filing failure states nothing was posted');
    expect(!!result && !/needs approval/i.test(result.message),
      'approval note absent when filing failed (no false pending state)');
    expect(calls.filedApprovals.length === 1, 'filing was attempted exactly once');
    pass('execute: filing failure surfaced, review kept');
  }

  // Worker payload contract — agentApprovalsWorker has NO smoke of its own and
  // imports supabase → react-native, so it can't load under tsx. Its exported
  // `applyApprovedReviewCommentAction` handler delegates payload validation +
  // body composition to these pure reviewChatCommand exports, tested directly.
  {
    const good = validateReviewCommentApprovalPayload({
      owner: 'acme', repo: 'rocket', number: 42,
      body: 'Findings…', prUrl: 'https://github.com/acme/rocket/pull/42',
    });
    expect(good.ok === true && good.value.owner === 'acme' && good.value.repo === 'rocket' &&
      good.value.number === 42 && good.value.body === 'Findings…',
      'valid payload accepted + normalized');

    const numericString = validateReviewCommentApprovalPayload({ owner: 'a', repo: 'b', number: '7', body: 'x' });
    expect(numericString.ok === true && numericString.value.number === 7, 'numeric-string PR number coerced');
    expect(numericString.ok === true && numericString.value.prUrl === 'https://github.com/a/b/pull/7',
      'missing prUrl reconstructed from owner/repo/number');

    expect(validateReviewCommentApprovalPayload({ repo: 'b', number: 7, body: 'x' }).ok === false,
      'missing owner rejected (fail closed)');
    expect(validateReviewCommentApprovalPayload({ owner: 'a', number: 7, body: 'x' }).ok === false,
      'missing repo rejected');
    expect(validateReviewCommentApprovalPayload({ owner: 'a', repo: 'b', number: 'soon', body: 'x' }).ok === false,
      'non-numeric PR number rejected');
    expect(validateReviewCommentApprovalPayload({ owner: 'a', repo: 'b', number: 0, body: 'x' }).ok === false,
      'PR #0 rejected');
    expect(validateReviewCommentApprovalPayload({ owner: 'a', repo: 'b', number: 7, body: '   ' }).ok === false,
      'blank comment body rejected');
    expect(validateReviewCommentApprovalPayload(null).ok === false, 'null payload rejected');
    expect(validateReviewCommentApprovalPayload('garbage').ok === false, 'non-object payload rejected');

    const oversize = validateReviewCommentApprovalPayload({
      owner: 'a', repo: 'b', number: 7, body: 'B'.repeat(20_000),
    });
    expect(oversize.ok === true && oversize.value.body.length <= REVIEW_COMMENT_BODY_BOUND,
      'oversize body re-clamped defensively on validate');

    const composed = composeReviewCommentBody('Findings body');
    expect(composed.startsWith('Findings body'), 'posted body keeps the findings first');
    expect(composed.endsWith(REVIEW_COMMENT_ATTRIBUTION),
      'posted body ends with the attribution line (PR readers see the source)');
    const bigComposed = composeReviewCommentBody('B'.repeat(20_000));
    expect(bigComposed.endsWith(REVIEW_COMMENT_ATTRIBUTION) &&
      bigComposed.length <= REVIEW_COMMENT_BODY_BOUND + REVIEW_COMMENT_ATTRIBUTION.length + 2,
      'oversize body clamped, attribution still survives at the end');
    expect(REVIEW_COMMENT_ACTION_TYPE === 'chat.review_comment',
      'action-type constant pinned (worker dispatch key)');
    expect(
      approvalWorkerSource.includes("normalized.startsWith('chat.') && normalized !== REVIEW_COMMENT_ACTION_TYPE")
        && approvalWorkerSource.includes('if (actionType === REVIEW_COMMENT_ACTION_TYPE)')
        && !approvalWorkerSource.includes("actionType.startsWith('scheduled_action.') || actionType.startsWith('chat.')"),
      'runtime-owned chat approvals do not swallow the real chat.review_comment worker handler',
    );
    pass('worker payload contract: validate + compose (pure, direct import)');
  }

  if (failures > 0) {
    console.error(`\n${failures} review chat command smoke failure(s)`);
    process.exit(1);
  }

  console.log('\nAll review chat command smoke cases passed.');
}

main().catch((error) => {
  console.error('review-chat-command smoke crashed:', error);
  process.exit(1);
});
