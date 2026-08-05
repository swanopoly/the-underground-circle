/**
 * task-pr-linkage-core-smoketest — the pure GitHub PR/commit/branch/compare
 * reference extractor (src/lib/taskPRLinkageCore.ts) that links a COMPLETED feed
 * task to real GitHub refs found in its deliverable, tool events, and attachments.
 * Load-bearing: a github.com PR URL → { prNumber, repo }; a commit URL → { sha };
 * "opened PR #45" prose → pull_request; a compare/tree URL → compare/branch; a
 * git.run "[main 7d3a1f2]" bracket → commit sha; HARD host-scope (only github.com;
 * javascript:/other-host/userinfo-spoof/subdomain-spoof all excluded); canonical
 * stored URLs (hostile query/fragment stripped); dedupe by url + redundant-twin
 * absorption; bounded (~20); labels; and total/never-throws on hostile input.
 *
 * Pure — loads under tsx (taskPRLinkageCore has zero imports).
 */

import {
  extractGitReferences,
  formatGitReferenceLabel,
  type GitReference,
} from '../src/lib/taskPRLinkageCore';

let passes = 0;
let failures = 0;
function assert(c: unknown, m: string, e?: string): void {
  if (c) passes++;
  else { failures++; console.error('FAIL: ' + m + (e ? ' :: ' + e : '')); }
}
function assertEq(a: unknown, b: unknown, m: string): void {
  assert(a === b, m, 'got ' + JSON.stringify(a) + ' want ' + JSON.stringify(b));
}

function refs(d: unknown): GitReference[] {
  return extractGitReferences({ deliverable: d } as any);
}
function has(rs: GitReference[], pred: (r: GitReference) => boolean): boolean {
  return rs.some(pred);
}

function main(): void {
  // ─── (1) PR URL → pull_request { prNumber, repo }, canonical url ───────────
  {
    const r = refs('Shipped it — see https://github.com/cswan801/the-underground-circle/pull/123 for review.');
    assertEq(r.length, 1, '(1) one ref from a PR url');
    assertEq(r[0].type, 'pull_request', '(1) type pull_request');
    assertEq(r[0].prNumber, 123, '(1) prNumber parsed');
    assertEq(r[0].repo, 'cswan801/the-underground-circle', '(1) repo parsed');
    assertEq(r[0].url, 'https://github.com/cswan801/the-underground-circle/pull/123', '(1) canonical url');
  }
  {
    // /pull/45/files tail + query + fragment → canonical base url, no ride-along.
    const r = refs('https://github.com/o/r/pull/45/files?w=1#diff-abc');
    assertEq(r.length, 1, '(1) PR with tail/query/fragment still one ref');
    assertEq(r[0].prNumber, 45, '(1) prNumber from /pull/45/files');
    assertEq(r[0].url, 'https://github.com/o/r/pull/45', '(1) canonical url drops tail/query/fragment');
  }

  // ─── (2) commit URL → commit { sha, repo } ────────────────────────────────
  {
    const r = refs('Fixed in https://github.com/o/r/commit/7d3a1f29ab001122334455667788990011223344 today.');
    assertEq(r.length, 1, '(2) one commit ref');
    assertEq(r[0].type, 'commit', '(2) type commit');
    assertEq(r[0].sha, '7d3a1f29ab001122334455667788990011223344', '(2) full sha parsed');
    assertEq(r[0].repo, 'o/r', '(2) commit repo parsed');
  }
  {
    // Uppercase sha in url → lowercased canonical.
    const r = refs('https://github.com/o/r/commit/ABCDEF1');
    assertEq(r[0]?.sha, 'abcdef1', '(2) short sha lowercased');
    assertEq(r[0]?.url, 'https://github.com/o/r/commit/abcdef1', '(2) canonical commit url lowercased');
  }

  // ─── (3) prose "opened PR #45" → pull_request (no repo/url) ────────────────
  {
    const r = refs('I opened PR #45 against the release branch.');
    assertEq(r.length, 1, '(3) prose PR yields one ref');
    assertEq(r[0].type, 'pull_request', '(3) prose type pull_request');
    assertEq(r[0].prNumber, 45, '(3) prose prNumber');
    assertEq(r[0].url, '', '(3) prose ref has empty url');
    assertEq(r[0].repo, undefined, '(3) prose ref has no repo');
  }
  {
    assertEq(refs('pull request #7 is up').length, 1, '(3) "pull request #7" form matches');
    assertEq(refs('PR#9 merged')[0]?.prNumber, 9, '(3) "PR#9" (no space) form matches');
  }
  {
    // word-boundary guard: not a real "PR" mention.
    assert(!has(refs('the supr#3 widget'), (x) => x.prNumber === 3), '(3) "supr#3" is NOT a PR');
    assertEq(refs('mysupr #4 today').length, 0, '(3) "mysupr #4" is NOT a PR');
  }

  // ─── (4) compare + tree(branch) URLs ──────────────────────────────────────
  {
    const r = refs('compare at https://github.com/o/r/compare/main...feature-x here');
    assertEq(r[0]?.type, 'compare', '(4) compare type');
    assertEq(r[0]?.repo, 'o/r', '(4) compare repo');
    assertEq(r[0]?.url, 'https://github.com/o/r/compare/main...feature-x', '(4) compare canonical url');
  }
  {
    const r = refs('branch https://github.com/o/r/tree/release-1 pushed');
    assertEq(r[0]?.type, 'branch', '(4) tree → branch type');
    assertEq(r[0]?.repo, 'o/r', '(4) branch repo');
  }

  // ─── (5) HARD host-scope — non-github / hostile hosts excluded ────────────
  {
    assertEq(refs('see https://gitlab.com/o/r/pull/1 nope').length, 0, '(5) non-github host excluded');
    assertEq(refs('https://example.com/o/r/pull/1').length, 0, '(5) example.com excluded');
    assertEq(refs('https://raw.githubusercontent.com/o/r/pull/1').length, 0, '(5) githubusercontent subdomain excluded');
    assertEq(refs('https://github.com.evil.com/o/r/pull/1').length, 0, '(5) github.com.evil.com suffix-spoof excluded');
    assertEq(refs('https://notgithub.com/o/r/pull/1').length, 0, '(5) notgithub.com prefix-spoof excluded');
    assertEq(refs('https://github.com@evil.com/o/r/pull/1').length, 0, '(5) userinfo spoof github.com@evil.com excluded');
    assertEq(refs('https://evil.com/github.com/o/r/pull/1').length, 0, '(5) path-embedded github.com excluded');
  }
  {
    // www.github.com IS allowed (canonicalized to github.com host in url).
    const r = refs('https://www.github.com/o/r/pull/8');
    assertEq(r.length, 1, '(5) www.github.com accepted');
    assertEq(r[0].url, 'https://github.com/o/r/pull/8', '(5) www canonicalized');
  }

  // ─── (6) scheme guard — javascript:/data:/file: never captured ────────────
  {
    assertEq(refs('javascript:alert(1)//github.com/o/r/pull/1').length, 0, '(6) javascript: scheme excluded');
    assertEq(refs('data:text/html,https://github.com/o/r/pull/1').length, 1, '(6) data: wrapper — inner https still host-scoped once');
    assertEq(refs('file:///github.com/o/r/pull/1').length, 0, '(6) file: scheme excluded');
  }

  // ─── (7) git.run tool-event commit bracket → commit sha ───────────────────
  {
    const out = extractGitReferences({
      toolEvents: [
        { tool: 'git.run', status: 'completed', summary: '$ git commit -m msg\nexit 0 in 0.2s\n--- stdout ---\n[main 7d3a1f2] fix the bug\n 1 file changed' },
      ],
    } as any);
    assertEq(out.length, 1, '(7) one commit from git.run bracket');
    assertEq(out[0].type, 'commit', '(7) bracket type commit');
    assertEq(out[0].sha, '7d3a1f2', '(7) bracket sha');
    assertEq(out[0].repo, undefined, '(7) bracket commit has no repo (no remote)');
  }
  {
    // root-commit variant + branch name with slash.
    const out = extractGitReferences({
      toolEvents: [{ tool: 'git.run', result: '[feature/x (root-commit) e3a1b2c] init' }],
    } as any);
    assertEq(out[0]?.sha, 'e3a1b2c', '(7) root-commit sha parsed');
  }
  {
    // A NON-git tool with an incidental bracket must NOT yield a commit.
    const out = extractGitReferences({
      toolEvents: [{ tool: 'local.read_file', summary: '[INFO 1234567] log line' }],
    } as any);
    assertEq(out.length, 0, '(7) non-git tool bracket ignored');
  }

  // ─── (8) git.run push → branch ref with repo (remote-derived) ─────────────
  {
    const out = extractGitReferences({
      toolEvents: [
        {
          tool: 'git.run',
          summary: '$ git push -u origin feature-x\nTo github.com:acme/widgets.git\n * [new branch]      feature-x -> feature-x',
        },
      ],
    } as any);
    assert(has(out, (x) => x.type === 'branch' && x.repo === 'acme/widgets'), '(8) branch ref from push output', JSON.stringify(out));
    assert(has(out, (x) => x.url === 'https://github.com/acme/widgets/tree/feature-x'), '(8) canonical tree url from remote+branch', JSON.stringify(out));
  }
  {
    // "Switched to a new branch 'X'" with a known remote in same event.
    const out = extractGitReferences({
      toolEvents: [{ tool: 'git.run', summary: "remote https://github.com/acme/widgets.git\nSwitched to a new branch 'hotfix'" }],
    } as any);
    assert(has(out, (x) => x.type === 'branch' && x.repo === 'acme/widgets'), '(8) checkout new-branch → branch ref', JSON.stringify(out));
  }

  // ─── (9) attachments: github url in attachment.url ────────────────────────
  {
    const out = extractGitReferences({
      attachments: [
        { name: 'diff', type: 'code', language: 'ts' },
        { name: 'PR link', type: 'file', url: 'https://github.com/o/r/pull/321' },
        { name: 'ext', type: 'file', url: 'https://example.com/x' },
      ],
    } as any);
    assertEq(out.length, 1, '(9) only the github attachment url counts');
    assertEq(out[0].prNumber, 321, '(9) attachment PR number');
  }

  // ─── (10) dedupe by url + redundant-twin absorption ───────────────────────
  {
    // same PR url twice (different tails) → one ref.
    const r = refs('a https://github.com/o/r/pull/5 and b https://github.com/o/r/pull/5/files');
    assertEq(r.length, 1, '(10) duplicate PR url deduped to one');
  }
  {
    // prose "PR #5" absorbed once the real /pull/5 url is present (same input).
    const r = refs('opened PR #5 → https://github.com/o/r/pull/5');
    assertEq(r.length, 1, '(10) prose PR absorbed by full PR url');
    assertEq(r[0].repo, 'o/r', '(10) surviving ref is the full one');
  }
  {
    // two DIFFERENT prose PRs are NOT collapsed (empty-url identity is typed).
    const r = refs('opened PR #11 and PR #22');
    assertEq(r.length, 2, '(10) distinct prose PRs kept separate');
  }
  {
    // short bracket sha absorbed by a full commit-url sha with same prefix.
    const out = extractGitReferences({
      deliverable: 'https://github.com/o/r/commit/7d3a1f2900112233445566778899001122334455',
      toolEvents: [{ tool: 'git.run', summary: '[main 7d3a1f2] fix' }],
    } as any);
    assertEq(out.length, 1, '(10) short bracket sha absorbed by full commit url');
    assertEq(out[0].repo, 'o/r', '(10) surviving commit is the full one');
  }

  // ─── (11) ordering + multi-source blend ───────────────────────────────────
  {
    const out = extractGitReferences({
      deliverable: 'PR at https://github.com/o/r/pull/1 then a commit https://github.com/o/r/commit/abc1234',
      toolEvents: [{ tool: 'git.run', summary: 'To github.com:o/r.git\n[main def5678] more' }],
    } as any);
    const types = out.map((x) => x.type);
    assert(types[0] === 'pull_request' && types[1] === 'commit', '(11) deliverable order preserved (pr before commit)', JSON.stringify(types));
    assert(has(out, (x) => x.type === 'commit' && x.sha === 'def5678'), '(11) tool-event commit included', JSON.stringify(out));
  }

  // ─── (12) formatGitReferenceLabel ─────────────────────────────────────────
  assertEq(formatGitReferenceLabel({ type: 'pull_request', url: 'x', prNumber: 123, repo: 'owner/repo' }), 'PR #123 (owner/repo)', '(12) PR label');
  assertEq(formatGitReferenceLabel({ type: 'pull_request', url: '', prNumber: 45 }), 'PR #45', '(12) PR label no repo');
  assertEq(formatGitReferenceLabel({ type: 'commit', url: 'https://github.com/owner/repo/commit/abc1234def', sha: 'abc1234def', repo: 'owner/repo' }), 'commit abc1234 (owner/repo)', '(12) commit label short-sha');
  assertEq(formatGitReferenceLabel({ type: 'branch', url: 'https://github.com/o/r/tree/feature/x', repo: 'o/r' }), 'branch feature/x (o/r)', '(12) branch label pulls name from url');
  assertEq(formatGitReferenceLabel({ type: 'compare', url: 'https://github.com/o/r/compare/main...feat', repo: 'o/r' }), 'compare main...feat (o/r)', '(12) compare label pulls spec from url');
  assertEq(formatGitReferenceLabel({ type: 'pull_request', url: '' }), 'PR', '(12) PR with no number/repo');
  assertEq(formatGitReferenceLabel({ type: 'commit', url: '', repo: 'o/r' }), 'commit (o/r)', '(12) commit no sha');

  // ─── (13) end-to-end realistic completion payload ─────────────────────────
  {
    const out = extractGitReferences({
      deliverable: [
        'Done. I opened PR #204 and it is passing CI.',
        'PR: https://github.com/cswan801/the-underground-circle/pull/204',
        'Base commit: https://github.com/cswan801/the-underground-circle/commit/9f8e7d6c5b4a39281706',
      ].join('\n'),
      toolEvents: [
        { tool: 'git.run', status: 'completed', summary: '$ git commit -m "feat: linkage"\nexit 0\n[wip/pr-linkage 9f8e7d6] feat: linkage' },
        { tool: 'git.run', status: 'completed', summary: 'To github.com:cswan801/the-underground-circle.git\n * [new branch]  wip/pr-linkage -> wip/pr-linkage' },
      ],
      attachments: [{ name: 'PR', type: 'file', url: 'https://github.com/cswan801/the-underground-circle/pull/204' }],
    } as any);
    assert(has(out, (x) => x.type === 'pull_request' && x.prNumber === 204 && x.repo === 'cswan801/the-underground-circle'), '(13) PR #204 with repo', JSON.stringify(out));
    assert(has(out, (x) => x.type === 'commit' && (x.sha || '').startsWith('9f8e7d6')), '(13) commit ref present', JSON.stringify(out));
    assert(has(out, (x) => x.type === 'branch' && x.repo === 'cswan801/the-underground-circle'), '(13) branch ref present', JSON.stringify(out));
    // no repo-less prose PR twin survives, and the PR is not double-listed.
    assertEq(out.filter((x) => x.type === 'pull_request').length, 1, '(13) PR appears exactly once');
    assert(out.length <= 20, '(13) bounded output', String(out.length));
    const labels = out.map(formatGitReferenceLabel);
    assert(labels.includes('PR #204 (cswan801/the-underground-circle)'), '(13) PR label rendered', JSON.stringify(labels));
  }

  // ─── (14) bounded to ~20 even with a firehose of refs ─────────────────────
  {
    const many: string[] = [];
    for (let i = 0; i < 60; i += 1) many.push(`https://github.com/o/r/pull/${i}`);
    const out = refs(many.join(' \n '));
    assert(out.length <= 20, '(14) capped at 20 refs', String(out.length));
    assert(out.length > 0, '(14) still returns some refs', String(out.length));
  }

  // ─── (15) hostile / degenerate — TOTAL, never throws, safe neutral ────────
  {
    const cyclic: any = { deliverable: 'x' };
    cyclic.self = cyclic;
    const evilEvent: any = {};
    evilEvent.loop = evilEvent;
    let threw = false;
    try {
      assertEq(extractGitReferences(undefined as any).length, 0, '(15) undefined input → []');
      assertEq(extractGitReferences(null as any).length, 0, '(15) null input → []');
      assertEq(extractGitReferences('nope' as any).length, 0, '(15) string input → []');
      assertEq(extractGitReferences(123 as any).length, 0, '(15) number input → []');
      assertEq(extractGitReferences([] as any).length, 0, '(15) array input → []');
      assertEq(extractGitReferences({} as any).length, 0, '(15) empty object → []');
      assertEq(extractGitReferences({ deliverable: 42, toolEvents: 'x', attachments: 7 } as any).length, 0, '(15) wrong-typed fields → []');
      assertEq(extractGitReferences({ deliverable: cyclic } as any).length, 0, '(15) cyclic deliverable value (non-string) → []');
      assertEq(extractGitReferences(cyclic).length, 0, '(15) cyclic input object → []');
      assertEq(extractGitReferences({ toolEvents: [null, undefined, 5, {}, evilEvent, { tool: 'git.run' }] } as any).length, 0, '(15) junk tool events → []');
      assertEq(extractGitReferences({ attachments: [null, 5, { url: 42 }, { url: '' }] } as any).length, 0, '(15) junk attachments → []');
      assertEq(extractGitReferences({ deliverable: 'x'.repeat(500_000) } as any).length, 0, '(15) huge deliverable → [] (no refs, no hang)');
      // formatGitReferenceLabel totality
      assertEq(formatGitReferenceLabel(undefined as any), '', '(15) label(undefined) → ""');
      assertEq(formatGitReferenceLabel(null as any), '', '(15) label(null) → ""');
      assertEq(formatGitReferenceLabel('x' as any), '', '(15) label(string) → ""');
      assertEq(formatGitReferenceLabel({} as any), '', '(15) label({}) → ""');
      assertEq(formatGitReferenceLabel({ type: 'bogus', url: '' } as any), '', '(15) label(unknown type) → ""');
      assertEq(formatGitReferenceLabel({ type: 'pull_request', url: '', prNumber: NaN } as any), 'PR', '(15) label(NaN prNumber) → "PR"');
      assertEq(formatGitReferenceLabel({ type: 'commit', url: 5, sha: 7 } as any), 'commit', '(15) label(wrong-typed fields) → "commit"');
      const cyclicRef: any = { type: 'branch', url: 'https://github.com/o/r/tree/main', repo: 'o/r' };
      cyclicRef.self = cyclicRef;
      assertEq(formatGitReferenceLabel(cyclicRef), 'branch main (o/r)', '(15) label(cyclic ref) still works');
      assert(formatGitReferenceLabel({ type: 'pull_request', url: '', prNumber: 1, repo: 'a'.repeat(5000) } as any).length <= 300, '(15) label bounded for huge repo');
    } catch (e) {
      threw = true;
      console.error('THREW: ' + (e as Error)?.message);
    }
    assert(!threw, '(15) no hostile input ever throws');
  }

  const total = passes + failures;
  console.log('task-pr-linkage-core smoke: ' + passes + ' passed, ' + failures + ' failed (of ' + total + ')');
  if (failures > 0) { console.error('\n' + failures + ' fail'); process.exit(1); }
  console.log('\nAll task-pr-linkage-core smoke cases passed (' + passes + ' passed).');
}

main();
