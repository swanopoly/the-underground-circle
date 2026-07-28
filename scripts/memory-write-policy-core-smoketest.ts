/**
 * memory-write-policy-core-smoketest — src/lib/memoryWritePolicyCore.ts
 *
 * Regression origin: a live production check on 2026-07-28 found 4,621 of 4,716
 * active memories (98%) in 26 duplicate-title groups, one title repeated 3,020
 * times, because `saveMemory` deduped only `scope === 'session'` and `circle`
 * scope fell through to an unconditional INSERT.
 *
 * The invariants below are the ones that make that impossible again — and the
 * ones that keep the fix from over-correcting into destroying content.
 *
 * Usage: npm run smoke:memory-write-policy-core
 */

import {
  memoryWriteScopePolicy,
  evaluateDedupeEligibility,
  clampMemoryText,
  MEMORY_WRITE_SCOPES,
  MEMORY_CONTENT_MAX_CHARS,
  MEMORY_TITLE_MAX_CHARS,
} from '../src/lib/memoryWritePolicyCore';

let passed = 0;
let failed = 0;
function check(label: string, ok: boolean): void {
  if (ok) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; console.log(`  ✗ ${label}`); }
}
const eq = (a: unknown, b: unknown, label: string) => check(`${label} :: got ${JSON.stringify(a)} want ${JSON.stringify(b)}`, a === b);

// ─── 1. THE regression: circle scope must dedupe ─────────────────────────────

{
  const circle = memoryWriteScopePolicy('circle');
  check('REGRESSION: circle scope dedupes (was `none` — 3,020 dup rows in prod)',
    circle.strategy !== 'none');
  // The first fix attempt used 'identity' here. Production data disproved it:
  // that title covers 1,889 distinct contents, so title-only merging destroys
  // records. This assertion is the guard against re-introducing that.
  eq(circle.strategy, 'content_identity', 'circle requires identical CONTENT, not just title');
  check('REGRESSION GUARD: circle must never be title-identity (would destroy 1,889 distinct rows)',
    circle.strategy !== 'identity');

  const elig = evaluateDedupeEligibility({
    scope: 'circle', circleId: 'c1', title: 'Workflow: cc / the-underground-circle',
  });
  check('REGRESSION: the exact prod title is now dedupe-eligible', elig.eligible && elig.strategy === 'content_identity');

  // Session behaviour must be untouched — it already worked.
  eq(memoryWriteScopePolicy('session').strategy, 'identity', 'session unchanged');
}

// ─── 2. Every known scope dedupes; unknown scopes never merge ────────────────

{
  check('every known scope has a real strategy',
    MEMORY_WRITE_SCOPES.every((s) => memoryWriteScopePolicy(s).strategy !== 'none'));
  check('the scope list covers the ones saveMemory actually writes',
    ['session', 'circle', 'user', 'agent', 'room'].every((s) => MEMORY_WRITE_SCOPES.includes(s)));

  // Unknown/garbage ⇒ insert. Merging on an unrecognized scope could destroy
  // rows from a scope this module has never seen.
  for (const bad of ['nope', '', null, undefined, 42, {}, [], true]) {
    const p = memoryWriteScopePolicy(bad as never);
    if (p.strategy !== 'none') { check(`unknown scope ${JSON.stringify(bad)} must not merge`, false); break; }
  }
  check('unknown/garbage scope always inserts (never merges)', true);
  eq(memoryWriteScopePolicy('nope').candidateLimit, 0, 'no candidates loaded for an unknown scope');
}

// ─── 3. Identity keys are per-scope (merging across them is data loss) ──────

{
  const agent = memoryWriteScopePolicy('agent');
  check('agent scope keys on agent_id (never merge across agents)', agent.identityKeys.includes('agent_id'));
  check('agent scope keys on user_id (never merge across owners)', agent.identityKeys.includes('user_id'));
  check('circle scope does NOT key on agent_id', !memoryWriteScopePolicy('circle').identityKeys.includes('agent_id'));

  const user = memoryWriteScopePolicy('user');
  check('user scope keys on owner', user.identityKeys.includes('user_id'));
  check('similarity scopes bound their candidate load (write path, not a scan)',
    ['user', 'agent', 'room'].every((s) => {
      const p = memoryWriteScopePolicy(s);
      return p.candidateLimit > 0 && p.candidateLimit <= 100;
    }));
}

// ─── 4. Eligibility fails CLOSED on anything ambiguous ──────────────────────

{
  const noCircle = evaluateDedupeEligibility({ scope: 'circle', circleId: '', title: 'T' });
  check('no circle ⇒ not eligible (insert)', !noCircle.eligible && noCircle.reason === 'missing_circle');

  const noTitle = evaluateDedupeEligibility({ scope: 'circle', circleId: 'c1', title: '   ' });
  check('blank title ⇒ not eligible (no stable identity to match on)',
    !noTitle.eligible && noTitle.reason === 'missing_title');

  const unknown = evaluateDedupeEligibility({ scope: 'wat', circleId: 'c1', title: 'T' });
  check('unknown scope ⇒ not eligible', !unknown.eligible && unknown.reason === 'scope_has_no_dedupe');

  check('degenerate input never throws', (() => {
    try {
      evaluateDedupeEligibility(null as never);
      evaluateDedupeEligibility({} as never);
      evaluateDedupeEligibility({ scope: {}, circleId: [], title: 7 } as never);
      return true;
    } catch { return false; }
  })());
}

// ─── 5. Content caps match the edge (client had none) ───────────────────────

{
  const long = 'x'.repeat(MEMORY_CONTENT_MAX_CHARS + 500);
  const r = clampMemoryText('t', long);
  eq(r.content.length, MEMORY_CONTENT_MAX_CHARS, 'content clamped to the edge cap');
  check('truncation is REPORTED, not silent', r.contentTruncated === true);

  const okr = clampMemoryText('t', 'short');
  check('under-cap content is untouched and not flagged',
    okr.content === 'short' && okr.contentTruncated === false);

  const lt = clampMemoryText('T'.repeat(MEMORY_TITLE_MAX_CHARS + 50), 'c');
  check('title clamped + reported', lt.title.length === MEMORY_TITLE_MAX_CHARS && lt.titleTruncated);

  const junk = clampMemoryText(null, undefined);
  check('non-string input degrades to empty, never throws',
    junk.title === '' && junk.content === '' && !junk.titleTruncated);
  eq(clampMemoryText(123 as never, {} as never).content, '', 'numeric/object content → empty string');
}

// ─── 6. Determinism + documentation ─────────────────────────────────────────

{
  check('policy lookup is deterministic',
    JSON.stringify(memoryWriteScopePolicy('circle')) === JSON.stringify(memoryWriteScopePolicy('circle')));
  check('every policy explains itself (why: non-empty)',
    MEMORY_WRITE_SCOPES.every((s) => memoryWriteScopePolicy(s).why.length > 20));
}

console.log(`\nmemory-write-policy-core smoketest: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
