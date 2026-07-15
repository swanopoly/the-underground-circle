/**
 * approval-preview-core-smoketest — pins the pure approval-card preview +
 * staleness core (src/lib/approvalPreviewCore.ts) that fixes two approval-UX
 * findings: approval cards never showed WHAT will run, and pending approvals
 * never expired. Load-bearing assertions:
 *
 *   REDACTION (redactSecretsForPreview): key=value / key: value masking for
 *   token/secret/password/api-key-ish identifiers (including MY_TOKEN-style
 *   prefixed names and `Authorization: Bearer <tok>` in one shot), URL
 *   user:password@ credentials, op:// 1Password refs, bare Bearer headers,
 *   sk-/ghp_/github_pat_/xox/AKIA/JWT token shapes; plain text unchanged;
 *   non-string coercion; output bounded ≤ 2000 chars.
 *
 *   PREVIEW (buildApprovalPreview): local.run_shell shows `$ argv…` + cwd and
 *   flags rm/drop/delete as destructive (word-boundary safe: "warm"/"format"
 *   stay write); git.run shows `git <verb> <args>` + repo and flags
 *   push --force/-f/--force-with-lease/--delete, reset --hard, clean -f,
 *   branch -D, rm, stash drop as destructive while status/log/diff read;
 *   commit -m free text is NOT scanned for destructive words; gmail.write
 *   shows To/Subject (send=destructive, draft=write); wp.* shows site +
 *   post #id "title" (trash=destructive, list/discover=read) and never leaks
 *   onePasswordItem; desktop.edit_file shows path + N edits;
 *   desktop.file_write_text shows path + append/overwrite/write + chars
 *   (overwrite=destructive); default tools get `Run <tool>` + compact arg
 *   summary with risk inferred from name segments; send/notify tools surface
 *   recipient. Detail always < 300 chars, title ≤ 120, secrets redacted.
 *
 *   STALENESS: classifyApprovalAge boundaries (fresh < 5 min ≤ stale
 *   < 30 min ≤ expired) with fail-closed 'expired' on unknown ages;
 *   describeApprovalAge wording ('just now' / 'X min ago' /
 *   'expired (X min|hr|days old)' / 'age unknown').
 *
 *   And: every export is total — degenerate/wrong-type/huge input never throws.
 *
 * Pure — loads under tsx (approvalPreviewCore has zero runtime imports).
 */

import {
  buildApprovalPreview,
  redactSecretsForPreview,
  classifyApprovalAge,
  describeApprovalAge,
  APPROVAL_STALE_MS,
  APPROVAL_EXPIRED_MS,
  type ApprovalPreview,
  type ApprovalStaleness,
} from '../src/lib/approvalPreviewCore';

let passes = 0;
let failures = 0;
function assert(cond: unknown, msg: string, extra?: string): void {
  if (cond) passes += 1;
  else { failures += 1; console.error(`FAIL: ${msg}${extra ? ` :: ${extra}` : ''}`); }
}
function assertEq(a: unknown, b: unknown, msg: string): void {
  assert(a === b, msg, `got ${JSON.stringify(a)} want ${JSON.stringify(b)}`);
}

/** Helper: preview shape is structurally valid. */
function isValidPreview(p: ApprovalPreview): boolean {
  return !!p
    && typeof p.title === 'string' && p.title.length > 0 && p.title.length <= 120
    && typeof p.detail === 'string' && p.detail.length < 300
    && (p.risk === 'read' || p.risk === 'write' || p.risk === 'destructive');
}

function main(): void {
  // ─── (1) constants ─────────────────────────────────────────────────────────
  assertEq(APPROVAL_STALE_MS, 5 * 60_000, '(1) APPROVAL_STALE_MS is 5 min');
  assertEq(APPROVAL_EXPIRED_MS, 30 * 60_000, '(1) APPROVAL_EXPIRED_MS is 30 min');

  // ─── (2) redaction: key=value and header shapes ────────────────────────────
  assertEq(redactSecretsForPreview('MY_TOKEN=abcdef123456'), 'MY_TOKEN=[redacted]', '(2) prefixed TOKEN env var masked');
  assertEq(redactSecretsForPreview('password: hunter2'), 'password: [redacted]', '(2) password: value masked');
  assertEq(redactSecretsForPreview('OPENAI_API_KEY=sk-proj-abc123def456'), 'OPENAI_API_KEY=[redacted]', '(2) api key env var masked');
  assertEq(
    redactSecretsForPreview('Authorization: Bearer abc123def456ghi'),
    'Authorization: [redacted]',
    '(2) Authorization: Bearer masks header AND token in one shot',
  );
  assertEq(redactSecretsForPreview('"client_secret": "shh-value-123"'), '"client_secret": [redacted]', '(2) quoted JSON secret masked');
  assertEq(
    redactSecretsForPreview('https://admin:supersecret@site.com/wp-admin'),
    'https://admin:[redacted]@site.com/wp-admin',
    '(2) URL credentials masked',
  );
  assertEq(redactSecretsForPreview('op://Private/GitHub/pat'), 'op://[redacted]', '(2) 1Password ref masked');
  assertEq(redactSecretsForPreview('use Bearer tok1234567 now'), 'use Bearer [redacted] now', '(2) bare Bearer token masked');

  // ─── (3) redaction: bare token shapes + plain text untouched ───────────────
  assertEq(redactSecretsForPreview('sk-ant-api03-AAAABBBBCCCC'), '[redacted]', '(3) sk- style key masked');
  assertEq(redactSecretsForPreview('ghp_ABCDEFGHIJKLMNOP1234'), '[redacted]', '(3) GitHub ghp_ token masked');
  assertEq(redactSecretsForPreview('xoxb-1234-abcd-efgh'), '[redacted]', '(3) Slack xoxb token masked');
  assertEq(redactSecretsForPreview('AKIAIOSFODNN7EXAMPLE'), '[redacted]', '(3) AWS access key id masked');
  assert(
    !redactSecretsForPreview('eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.abc123def456').includes('eyJ'),
    '(3) JWT masked',
  );
  assertEq(
    redactSecretsForPreview('deploy the marketing site now'),
    'deploy the marketing site now',
    '(3) plain text unchanged',
  );
  assertEq(redactSecretsForPreview('run rm -rf /tmp/x'), 'run rm -rf /tmp/x', '(3) non-secret shell text unchanged');

  // ─── (4) redaction: coercion + bounds ──────────────────────────────────────
  assertEq(redactSecretsForPreview(null), '', '(4) null → empty string');
  assertEq(redactSecretsForPreview(undefined), '', '(4) undefined → empty string');
  assertEq(redactSecretsForPreview(42), '42', '(4) number coerced');
  assertEq(redactSecretsForPreview(true), 'true', '(4) boolean coerced');
  assertEq(redactSecretsForPreview({ a: 1 }), '{"a":1}', '(4) object JSON-coerced');
  assert(redactSecretsForPreview('x'.repeat(10_000)).length <= 2000, '(4) output bounded to 2000 chars');

  // ─── (5) classifyApprovalAge boundaries ────────────────────────────────────
  assertEq(classifyApprovalAge(0), 'fresh', '(5) 0ms fresh');
  assertEq(classifyApprovalAge(APPROVAL_STALE_MS - 1), 'fresh', '(5) stale boundary - 1 fresh');
  assertEq(classifyApprovalAge(APPROVAL_STALE_MS), 'stale', '(5) exactly stale boundary → stale');
  assertEq(classifyApprovalAge(10 * 60_000), 'stale', '(5) 10 min stale');
  assertEq(classifyApprovalAge(APPROVAL_EXPIRED_MS - 1), 'stale', '(5) expired boundary - 1 stale');
  assertEq(classifyApprovalAge(APPROVAL_EXPIRED_MS), 'expired', '(5) exactly expired boundary → expired');
  assertEq(classifyApprovalAge(86_400_000), 'expired', '(5) 1 day expired');
  assertEq(classifyApprovalAge(-5000), 'fresh', '(5) negative age (clock skew) fresh');
  assertEq(classifyApprovalAge('600000'), 'stale', '(5) numeric string accepted');

  // ─── (6) classifyApprovalAge fails closed on unknown ───────────────────────
  assertEq(classifyApprovalAge(null), 'expired', '(6) null → expired (fail closed)');
  assertEq(classifyApprovalAge(undefined), 'expired', '(6) undefined → expired');
  assertEq(classifyApprovalAge(NaN), 'expired', '(6) NaN → expired');
  assertEq(classifyApprovalAge(Infinity), 'expired', '(6) Infinity → expired');
  assertEq(classifyApprovalAge('abc'), 'expired', '(6) non-numeric string → expired');
  assertEq(classifyApprovalAge({}), 'expired', '(6) object → expired');
  assertEq(classifyApprovalAge(true), 'expired', '(6) boolean → expired');

  // ─── (7) describeApprovalAge wording ───────────────────────────────────────
  assertEq(describeApprovalAge(0), 'just now', '(7) 0ms just now');
  assertEq(describeApprovalAge(59_999), 'just now', '(7) <1 min just now');
  assertEq(describeApprovalAge(-10_000), 'just now', '(7) negative just now');
  assertEq(describeApprovalAge(60_000), '1 min ago', '(7) 1 min ago');
  assertEq(describeApprovalAge(5 * 60_000), '5 min ago', '(7) 5 min ago');
  assertEq(describeApprovalAge(29 * 60_000 + 59_999), '29 min ago', '(7) 29 min ago (last pre-expiry minute)');
  assertEq(describeApprovalAge(APPROVAL_EXPIRED_MS), 'expired (30 min old)', '(7) expiry boundary wording');
  assertEq(describeApprovalAge(119 * 60_000), 'expired (119 min old)', '(7) expired minutes wording');
  assertEq(describeApprovalAge(120 * 60_000), 'expired (2 hr old)', '(7) expired hours wording');
  assertEq(describeApprovalAge(47 * 3_600_000), 'expired (47 hr old)', '(7) 47 hr still hours');
  assertEq(describeApprovalAge(48 * 3_600_000), 'expired (2 days old)', '(7) 48 hr → days wording');
  assertEq(describeApprovalAge(10 * 86_400_000), 'expired (10 days old)', '(7) 10 days wording');
  assertEq(describeApprovalAge(null), 'age unknown', '(7) null → age unknown');
  assertEq(describeApprovalAge('oops'), 'age unknown', '(7) junk string → age unknown');

  // ─── (8) local.run_shell previews ──────────────────────────────────────────
  const sh1 = buildApprovalPreview('local.run_shell', { argv: ['npm', 'run', 'typecheck'], cwd: '/repo' });
  assertEq(sh1.title, 'Run shell command', '(8) shell title');
  assertEq(sh1.risk, 'write', '(8) plain command risk write');
  assert(sh1.detail.includes('npm run typecheck'), '(8) argv joined into detail', sh1.detail);
  assert(sh1.detail.includes('(cwd: /repo)'), '(8) cwd shown', sh1.detail);
  assert(sh1.detail.startsWith('$ '), '(8) detail reads as a command line', sh1.detail);
  assertEq(buildApprovalPreview('local.run_shell', { argv: ['rm', '-rf', 'node_modules'] }).risk, 'destructive', '(8) rm → destructive');
  assertEq(buildApprovalPreview('local.run_shell', { argv: ['sudo', 'rm', '-rf', '/tmp/x'] }).risk, 'destructive', '(8) sudo rm → destructive');
  assertEq(buildApprovalPreview('local.run_shell', { argv: ['psql', '-c', 'DROP TABLE users'] }).risk, 'destructive', '(8) DROP → destructive');
  assertEq(buildApprovalPreview('local.run_shell', { argv: ['curl', '-X', 'DELETE', 'https://api.example.com/1'] }).risk, 'destructive', '(8) DELETE → destructive');
  assertEq(buildApprovalPreview('local.run_shell', { argv: ['echo', 'warm'] }).risk, 'write', '(8) "warm" does not trip rm (word boundary)');
  assertEq(buildApprovalPreview('local.run_shell', { argv: ['npm', 'run', 'format'] }).risk, 'write', '(8) "format" does not trip rm');
  const sh2 = buildApprovalPreview('local.run_shell', {});
  assert(sh2.detail.includes('no command provided'), '(8) missing argv → explicit empty detail', sh2.detail);
  assert(!buildApprovalPreview('local.run_shell', { argv: ['ls'] }).detail.includes('cwd'), '(8) no cwd → no cwd suffix');

  // ─── (9) shell secrets never reach the card ────────────────────────────────
  const shSecret = buildApprovalPreview('local.run_shell', {
    argv: ['bash', '-lc', 'DEPLOY_TOKEN=abcSECRET123 ./deploy.sh'],
    cwd: '/repo',
  });
  assert(!shSecret.detail.includes('abcSECRET123'), '(9) env secret value not in detail', shSecret.detail);
  assert(shSecret.detail.includes('[redacted]'), '(9) redaction marker present', shSecret.detail);
  const shBearer = buildApprovalPreview('local.run_shell', { argv: ['curl', '-H', 'Authorization: Bearer tok_abc123456'] });
  assert(!shBearer.detail.includes('tok_abc123456'), '(9) bearer token not in detail', shBearer.detail);

  // ─── (10) git.run previews ─────────────────────────────────────────────────
  const g1 = buildApprovalPreview('git.run', { verb: 'push', args: ['origin', 'main'], repoPath: '/repo' });
  assertEq(g1.title, 'Git: push', '(10) git title carries verb');
  assertEq(g1.risk, 'write', '(10) normal push write');
  assert(g1.detail.includes('git push origin main'), '(10) git command line in detail', g1.detail);
  assert(g1.detail.includes('(repo: /repo)'), '(10) repo path shown', g1.detail);
  assertEq(buildApprovalPreview('git.run', { verb: 'push', args: ['--force', 'origin', 'main'] }).risk, 'destructive', '(10) push --force destructive');
  assertEq(buildApprovalPreview('git.run', { verb: 'push', args: ['-f'] }).risk, 'destructive', '(10) push -f destructive');
  assertEq(buildApprovalPreview('git.run', { verb: 'push', args: ['--force-with-lease'] }).risk, 'destructive', '(10) push --force-with-lease destructive');
  assertEq(buildApprovalPreview('git.run', { verb: 'push', args: ['--delete', 'origin', 'old'] }).risk, 'destructive', '(10) push --delete destructive');
  assertEq(buildApprovalPreview('git.run', { verb: 'reset', args: ['--hard', 'HEAD~1'] }).risk, 'destructive', '(10) reset --hard destructive');
  assertEq(buildApprovalPreview('git.run', { verb: 'reset', args: ['--soft', 'HEAD~1'] }).risk, 'write', '(10) reset --soft stays write');
  assertEq(buildApprovalPreview('git.run', { verb: 'status' }).risk, 'read', '(10) status read');
  assertEq(buildApprovalPreview('git.run', { verb: 'log', args: ['--oneline'] }).risk, 'read', '(10) log read');
  assertEq(buildApprovalPreview('git.run', { verb: 'branch', args: ['-D', 'old-branch'] }).risk, 'destructive', '(10) branch -D destructive');
  assertEq(buildApprovalPreview('git.run', { verb: 'clean', args: ['-fd'] }).risk, 'destructive', '(10) clean -fd destructive');
  assertEq(buildApprovalPreview('git.run', { verb: 'rm', args: ['file.txt'] }).risk, 'destructive', '(10) git rm destructive');
  assertEq(buildApprovalPreview('git.run', { verb: 'stash', args: ['drop'] }).risk, 'destructive', '(10) stash drop destructive');
  assertEq(buildApprovalPreview('git.run', { verb: 'commit', args: ['-m', 'fix: drop legacy flag'] }).risk, 'write', '(10) commit message with "drop" NOT destructive');
  const g2 = buildApprovalPreview('git.run', {});
  assertEq(g2.title, 'Git command', '(10) missing verb title fallback');
  assert(g2.detail.includes('no git verb provided'), '(10) missing verb detail', g2.detail);

  // ─── (11) gmail.write previews ─────────────────────────────────────────────
  const m1 = buildApprovalPreview('gmail.write', { action: 'send', to: 'bob@x.com', subject: 'Q3 report', bodyText: 'hello' });
  assertEq(m1.title, 'Send email', '(11) send title');
  assertEq(m1.risk, 'destructive', '(11) send is irreversible external → destructive');
  assert(m1.detail.includes('To: bob@x.com'), '(11) recipient shown', m1.detail);
  assert(m1.detail.includes('Subject: "Q3 report"'), '(11) subject shown', m1.detail);
  assert(m1.detail.includes('(5 chars)'), '(11) body length shown', m1.detail);
  const m2 = buildApprovalPreview('gmail.write', { action: 'draft', to: 'a@x.com', subject: 'Hi' });
  assertEq(m2.title, 'Draft email', '(11) draft title');
  assertEq(m2.risk, 'write', '(11) draft risk write');
  assert(buildApprovalPreview('gmail.write', { action: 'send' }).detail.includes('(no recipient)'), '(11) missing to flagged');
  const m3 = buildApprovalPreview('gmail.write', { action: 'send', to: 'a@x.com', cc: 'b@x.com', subject: 's' });
  assert(m3.detail.includes('cc: b@x.com'), '(11) cc shown', m3.detail);
  const m4 = buildApprovalPreview('gmail.write', { action: 'send', to: 'a@x.com', subject: 'token=abc12345' });
  assert(!m4.detail.includes('abc12345'), '(11) secret in subject redacted', m4.detail);
  assertEq(buildApprovalPreview('gmail.write', { to: 'a@x.com' }).title, 'Send email', '(11) unknown action defaults to send');

  // ─── (12) wp.* previews ────────────────────────────────────────────────────
  const w1 = buildApprovalPreview('wp.update_post', {
    siteUrl: 'https://dealer.com', onePasswordItem: 'DI WP Admin', postId: 12, title: 'Summer Sale', status: 'publish',
  });
  assertEq(w1.title, 'WordPress: update post', '(12) wp title from action');
  assertEq(w1.risk, 'write', '(12) update risk write');
  assert(w1.detail.includes('https://dealer.com'), '(12) site shown', w1.detail);
  assert(w1.detail.includes('post #12 "Summer Sale"'), '(12) post id + title shown', w1.detail);
  assert(w1.detail.includes('status: publish'), '(12) status shown', w1.detail);
  assert(!w1.detail.includes('DI WP Admin'), '(12) onePasswordItem never surfaces', w1.detail);
  const w2 = buildApprovalPreview('wp.trash_post', { siteUrl: 'https://d.com', onePasswordItem: 'x', postId: 9, expectedTitle: 'Old Post' });
  assertEq(w2.risk, 'destructive', '(12) trash destructive');
  assertEq(w2.title, 'WordPress: trash post', '(12) trash title');
  assert(w2.detail.includes('#9') && w2.detail.includes('Old Post'), '(12) trash shows target post', w2.detail);
  assertEq(buildApprovalPreview('wp.list_posts', { siteUrl: 'https://d.com' }).risk, 'read', '(12) list read');
  assertEq(buildApprovalPreview('wp.discover_types', { siteUrl: 'https://d.com' }).risk, 'read', '(12) discover read');
  assertEq(buildApprovalPreview('wp.create_slide', { siteUrl: 'https://d.com' }).title, 'WordPress: create slide', '(12) create slide title');

  // ─── (13) desktop file previews ────────────────────────────────────────────
  const e1 = buildApprovalPreview('desktop.edit_file', { path: '/a/b.ts', edits: [{}, {}, {}] });
  assertEq(e1.title, 'Edit file', '(13) edit title');
  assertEq(e1.risk, 'write', '(13) edit risk write');
  assert(e1.detail.includes('/a/b.ts') && e1.detail.includes('3 edits'), '(13) path + edit count', e1.detail);
  assert(buildApprovalPreview('desktop.edit_file', { path: '/a/b.ts', oldString: 'x', newString: 'y' }).detail.includes('1 edit'), '(13) single str_replace counts as 1 edit');
  assert(buildApprovalPreview('desktop.edit_file', { path: '/a/b.ts' }).detail.includes('no edits specified'), '(13) empty edit flagged');
  const f1 = buildApprovalPreview('desktop.file_write_text', { path: '/a/b.txt', content: 'hello world', overwrite: true });
  assertEq(f1.title, 'Write file', '(13) write title');
  assertEq(f1.risk, 'destructive', '(13) overwrite → destructive');
  assert(f1.detail.includes('overwrite 11 chars'), '(13) overwrite + content length', f1.detail);
  const f2 = buildApprovalPreview('desktop.file_write_text', { path: '/a/b.txt', content: 'xy', append: true });
  assertEq(f2.risk, 'write', '(13) append risk write');
  assert(f2.detail.includes('append 2 chars'), '(13) append mode shown', f2.detail);
  assert(buildApprovalPreview('desktop.file_write_text', { path: '/a/b.txt', content: 'z' }).detail.includes('write 1 chars'), '(13) plain write mode shown');

  // ─── (14) default tool previews + name-derived risk ────────────────────────
  const d1 = buildApprovalPreview('browser.click', { selector: '#submit', x: 10 });
  assertEq(d1.title, 'Run browser.click', '(14) default title');
  assertEq(d1.risk, 'write', '(14) default risk write');
  assert(d1.detail.includes('selector="#submit"') && d1.detail.includes('x=10'), '(14) compact arg summary', d1.detail);
  assertEq(buildApprovalPreview('context.search', { query: 'q' }).risk, 'read', '(14) search-named tool read');
  assertEq(buildApprovalPreview('gmail.read', { query: 'q' }).risk, 'read', '(14) gmail.read read');
  assertEq(buildApprovalPreview('memory.delete', { id: '1' }).risk, 'destructive', '(14) delete-named tool destructive');
  assertEq(buildApprovalPreview('clipboard.clear', {}).risk, 'destructive', '(14) clear-named tool destructive');
  const d2 = buildApprovalPreview('messaging.notify', { channel: '#ops', message: 'deploy done' });
  assertEq(d2.risk, 'destructive', '(14) notify is external send → destructive');
  assertEq(d2.title, 'Send via messaging.notify', '(14) send-ish title');
  assert(d2.detail.includes('#ops') && d2.detail.includes('deploy done'), '(14) recipient + message surfaced', d2.detail);
  assert(buildApprovalPreview('desktop.launch_app', {}).detail.includes('no arguments'), '(14) empty args noted');
  const d3 = buildApprovalPreview('some.tool', { items: [1, 2, 3], cfg: { a: 1 }, none: null });
  assert(d3.detail.includes('items=[3 items]'), '(14) arrays summarized', d3.detail);
  assert(d3.detail.includes('cfg={…}'), '(14) nested objects summarized', d3.detail);
  assert(d3.detail.includes('none=null'), '(14) nulls summarized', d3.detail);
  const d4 = buildApprovalPreview('some.tool', { a: 1, b: 2, c: 3, d: 4, e: 5, f: 6, g: 7, h: 8 });
  assert(d4.detail.includes('+2 more'), '(14) key overflow marked', d4.detail);

  // ─── (15) bounds: huge inputs stay bounded, newlines flattened ─────────────
  const huge1 = buildApprovalPreview('local.run_shell', { argv: Array.from({ length: 200 }, () => 'x'.repeat(50)), cwd: '/r' });
  assert(huge1.detail.length < 300, '(15) huge argv detail < 300', String(huge1.detail.length));
  assert(huge1.detail.includes('…'), '(15) huge argv detail marked truncated', huge1.detail.slice(-10));
  const huge2 = buildApprovalPreview('gmail.write', { action: 'send', to: 'a@x.com', subject: 's'.repeat(5000), bodyText: 'b'.repeat(100_000) });
  assert(huge2.detail.length < 300, '(15) huge subject/body detail < 300', String(huge2.detail.length));
  const huge3 = buildApprovalPreview('x'.repeat(500), { q: 'y'.repeat(5000) });
  assert(huge3.title.length <= 120, '(15) huge tool name title ≤ 120', String(huge3.title.length));
  assert(huge3.detail.length < 300, '(15) huge default summary < 300', String(huge3.detail.length));
  const nl = buildApprovalPreview('gmail.write', { action: 'send', to: 'a@x.com', subject: 'line1\nline2\tline3' });
  assert(!nl.detail.includes('\n') && !nl.detail.includes('\t'), '(15) newlines/tabs flattened', JSON.stringify(nl.detail));

  // ─── (16) degenerate input never throws, always valid shape ───────────────
  try {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    const degenerates: Array<[unknown, unknown]> = [
      [null, null],
      [undefined, undefined],
      [123, 'string-args'],
      [{}, []],
      ['', ''],
      [true, false],
      [Symbol('t'), Symbol('a')],
      [() => 'x', () => 'y'],
      ['local.run_shell', { argv: 'not-an-array' }],
      ['local.run_shell', { argv: [null, {}, 42, undefined] }],
      ['git.run', { verb: 42, args: 'x', repoPath: {} }],
      ['gmail.write', null],
      ['wp.update_post', 'not-an-object'],
      ['wp.', []],
      ['desktop.edit_file', { edits: 'nope' }],
      ['desktop.file_write_text', []],
      ['some.tool', circular],
    ];
    for (const [tool, args] of degenerates) {
      const p = buildApprovalPreview(tool, args);
      assert(isValidPreview(p), `(16) buildApprovalPreview(${String(tool)}) valid shape`, JSON.stringify(p));
    }
    assertEq(typeof redactSecretsForPreview(circular), 'string', '(16) redact(circular) returns string');
    assertEq(redactSecretsForPreview(Symbol('s') as unknown), '', '(16) redact(symbol) safe');
    assertEq(typeof redactSecretsForPreview(BigInt(5) as unknown), 'string', '(16) redact(bigint) safe');
    const staleDegenerates: unknown[] = [null, undefined, NaN, Infinity, -Infinity, 'x', {}, [], true, Symbol('n'), () => 1];
    for (const v of staleDegenerates) {
      const c: ApprovalStaleness = classifyApprovalAge(v);
      assert(c === 'fresh' || c === 'stale' || c === 'expired', '(16) classifyApprovalAge total', String(c));
      assert(typeof describeApprovalAge(v) === 'string', '(16) describeApprovalAge total');
    }
    passes += 1;
  } catch (e) {
    failures += 1;
    console.error(`FAIL: (16) degenerate inputs threw: ${(e as Error)?.message}`);
  }

  if (failures > 0) {
    console.error(`\n${failures} failure(s), ${passes} passed`);
    process.exit(1);
  }
  console.log(`\nAll approval-preview-core smoke cases passed (${passes} passed).`);
}

main();
