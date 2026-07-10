/**
 * approval-intent-preview-smoketest — verifies the "Intent Preview" trust
 * pattern builder (src/lib/approvalIntentPreview.ts): plain-language intent
 * lines, the four-tier risk mapping + chip tones, secret-stripped scope facts,
 * the three-choice lane, and total (never-throw) behavior on degenerate input.
 *
 * The load-bearing security assertion: a raw token / password / api key in the
 * payload must NEVER appear in any field the builder returns.
 *
 * Run: npm run smoke:approval-intent-preview
 */

import {
  buildApprovalIntentPreview,
  describeApprovalRiskChip,
  deriveApprovalRiskTier,
  buildApprovalScopeLines,
  approvalChoicesForTier,
  tierFromComputerTaskRisk,
  isSecretKeyName,
  type ApprovalRiskTier,
} from '../src/lib/approvalIntentPreview';

let failures = 0;
function fail(m: string) { failures += 1; console.error('FAIL:', m); }
function pass(m: string) { console.log('pass:', m); }
function assert(cond: unknown, name: string, detail?: string) {
  if (cond) pass(name); else fail(`${name}${detail ? ' — ' + detail : ''}`);
}

/** Every field of a preview flattened to one lowercase string, for leak checks. */
function flatten(p: ReturnType<typeof buildApprovalIntentPreview>): string {
  return [p.intentLine, p.riskChip.label, ...p.scopeLines].join('\n').toLowerCase();
}

function main() {
  // ─── 1. Risk-tier mapping from action_type ──────────────────────────
  {
    const t = deriveApprovalRiskTier({ action_type: 'wp.publish_post' });
    assert(t === 'external', 'publish → external');
  }
  {
    const t = deriveApprovalRiskTier({ action_type: 'wp.trash_post' });
    assert(t === 'irreversible', 'trash/delete → irreversible');
  }
  {
    const t = deriveApprovalRiskTier({ action_type: 'files.delete' });
    assert(t === 'irreversible', 'delete → irreversible');
  }
  {
    const t = deriveApprovalRiskTier({ action_type: 'memory.list' });
    assert(t === 'read', 'list → read');
  }
  {
    const t = deriveApprovalRiskTier({ action_type: 'notes.edit' });
    assert(t === 'reversible', 'edit → reversible');
  }
  {
    const t = deriveApprovalRiskTier({ action_type: 'notes.update' });
    assert(t === 'reversible', 'update → reversible');
  }
  {
    const t = deriveApprovalRiskTier({ action_type: 'payments.charge' });
    assert(t === 'irreversible', 'pay/charge → irreversible');
  }
  {
    const t = deriveApprovalRiskTier({ action_type: 'vault.grant' });
    assert(t === 'irreversible', 'grant → irreversible');
  }
  {
    const t = deriveApprovalRiskTier({ action_type: 'auth.login' });
    assert(t === 'external', 'login → external');
  }
  {
    const t = deriveApprovalRiskTier({ action_type: 'browser.read_dom' });
    assert(t === 'read', 'read → read');
  }

  // ─── 2. Tier from reason when action_type is absent ─────────────────
  {
    const t = deriveApprovalRiskTier({ reason: 'submit, publish, send, pay, or delete' });
    assert(t === 'irreversible', 'reason with pay/delete → irreversible (most severe wins)');
  }
  {
    const t = deriveApprovalRiskTier({ reason: 'cross-origin navigation' });
    assert(t === 'reversible', 'reason "navigation" → reversible');
  }
  {
    const t = deriveApprovalRiskTier({ reason: 'read the accessibility tree' });
    assert(t === 'read', 'reason "read" → read');
  }

  // ─── 3. Explicit riskTier wins; unknown falls back safely ───────────
  {
    const t = deriveApprovalRiskTier({ action_type: 'files.delete', riskTier: 'read' });
    assert(t === 'read', 'explicit riskTier overrides action_type');
  }
  {
    const t = deriveApprovalRiskTier({ action_type: 'something.weird_verb' });
    assert(t === 'reversible', 'unknown verb falls back to reversible (never silently read)');
  }
  {
    const t = deriveApprovalRiskTier({});
    assert(t === 'reversible', 'empty input → reversible fallback');
  }
  {
    // Contract vocabulary accepted as an explicit tier.
    const t = deriveApprovalRiskTier({ riskTier: 'critical' });
    assert(t === 'irreversible', 'explicit "critical" → irreversible');
  }

  // ─── 4. Chip tone mapping (branding review colors) ──────────────────
  {
    assert(describeApprovalRiskChip('read').tone === 'green', 'chip read → green');
    assert(describeApprovalRiskChip('reversible').tone === 'blue', 'chip reversible → blue');
    assert(describeApprovalRiskChip('external').tone === 'amber', 'chip external → amber');
    assert(describeApprovalRiskChip('irreversible').tone === 'red', 'chip irreversible → red');
  }
  {
    assert(describeApprovalRiskChip('read').label === 'READ', 'chip read label');
    assert(describeApprovalRiskChip('irreversible').label === 'IRREVERSIBLE', 'chip irreversible label');
  }
  {
    // Unknown / null tier → safe visible chip, no throw.
    assert(describeApprovalRiskChip(null as any).tone === 'blue', 'chip null → blue (safe default)');
    assert(describeApprovalRiskChip('gibberish' as any).tone === 'blue', 'chip gibberish → blue');
  }
  {
    // Contract low/med/high/critical words accepted by the chip too.
    assert(describeApprovalRiskChip('high').tone === 'amber', 'chip "high" → amber');
    assert(describeApprovalRiskChip('low').tone === 'green', 'chip "low" → green');
  }

  // ─── 5. tierFromComputerTaskRisk bridge ─────────────────────────────
  {
    assert(tierFromComputerTaskRisk('low') === 'read', 'bridge low → read');
    assert(tierFromComputerTaskRisk('medium') === 'reversible', 'bridge medium → reversible');
    assert(tierFromComputerTaskRisk('high') === 'external', 'bridge high → external');
    assert(tierFromComputerTaskRisk('critical') === 'irreversible', 'bridge critical → irreversible');
  }

  // ─── 6. Intent-line derivation ──────────────────────────────────────
  {
    const p = buildApprovalIntentPreview({
      action_type: 'wp.publish_post',
      payload: { url: 'https://acme.com/blog', category: 'News' },
    });
    assert(p.intentLine.startsWith('Will '), 'intent line starts with "Will"');
    assert(/publish/i.test(p.intentLine), 'intent line names the publish verb');
    assert(p.intentLine.includes('acme.com/blog'), 'intent line names host + path target');
  }
  {
    const p = buildApprovalIntentPreview({
      action_type: 'files.delete',
      payload: { file: '/Users/me/secret-plans/q3.pdf' },
    });
    assert(/delete/i.test(p.intentLine), 'delete verb in intent line');
    assert(!p.intentLine.includes('/Users/'), 'intent line never leaks a full local path');
  }
  {
    const p = buildApprovalIntentPreview({
      action_type: 'custom_api.request',
      payload: { method: 'post', path: '/orders', apiName: 'Dealer CRM' },
    });
    // apiName is a target, so the line reads "... to Dealer CRM"; method/endpoint show in scope.
    assert(/dealer crm/i.test(p.intentLine) || /post \/orders/i.test(p.intentLine), 'http/api intent line legible');
  }
  {
    // No action_type, informative reason.
    const p = buildApprovalIntentPreview({ reason: 'send an email to the whole team' });
    assert(p.intentLine.startsWith('Will '), 'reason-only intent line starts with Will');
    assert(p.intentLine.length > 5, 'reason-only intent line non-empty');
  }
  {
    // No action_type, no useful reason → tier-based phrasing, still a sentence.
    const p = buildApprovalIntentPreview({});
    assert(p.intentLine.startsWith('Will '), 'empty intent line still starts with Will');
    assert(!/undefined|null|\[object/.test(p.intentLine), 'empty intent line has no junk tokens');
  }
  {
    // camelCase verb in action_type is spaced out.
    const p = buildApprovalIntentPreview({ action_type: 'design.generativeFill' });
    assert(/generative fill/i.test(p.intentLine), 'camelCase action verb humanized');
  }

  // ─── 7. Scope-line extraction ───────────────────────────────────────
  {
    const lines = buildApprovalScopeLines({
      site: 'acme.com',
      category: 'Announcements',
      visibility: 'public',
      ignored: 'this should not show',
    });
    assert(lines.length === 3, 'scope lines capped at 3');
    assert(lines.some((l) => l.startsWith('Target:') && l.includes('acme.com')), 'scope: target');
    assert(lines.some((l) => l.startsWith('Category:') && l.includes('Announcements')), 'scope: category');
    assert(lines.some((l) => l.startsWith('Visibility:') && l.includes('public')), 'scope: visibility');
    assert(!lines.some((l) => l.includes('this should not show')), 'scope: non-whitelisted field omitted');
  }
  {
    const lines = buildApprovalScopeLines({ file: '/Users/me/Desktop/report.xlsx' });
    assert(lines.some((l) => l === 'File: report.xlsx'), 'scope: file shown as basename only');
    assert(!lines.join('|').includes('/Users/'), 'scope: no local path leak');
  }
  {
    const lines = buildApprovalScopeLines({});
    assert(Array.isArray(lines) && lines.length === 0, 'empty payload → no scope lines');
  }
  {
    // Very long value is capped.
    const lines = buildApprovalScopeLines({ title: 'z'.repeat(300) });
    assert(lines.length === 1 && lines[0].length < 100, 'long scope value capped');
  }

  // ─── 8. SECRET STRIPPING (load-bearing) ─────────────────────────────
  {
    const TOKEN = 'sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789';
    const PW = 'hunter2-super-secret-password';
    const p = buildApprovalIntentPreview({
      action_type: 'auth.login',
      reason: `login using token ${TOKEN}`,
      payload: {
        url: 'https://portal.acme.com',
        token: TOKEN,
        password: PW,
        api_key: 'AKIAIOSFODNN7EXAMPLE1',
        authorization: `Bearer ${TOKEN}`,
        cookie: 'session=abcdef123456789012345',
      },
    });
    const flat = flatten(p);
    assert(!flat.includes(TOKEN.toLowerCase()), 'SECRET: sk- token never surfaced');
    assert(!flat.includes(PW.toLowerCase()), 'SECRET: password never surfaced');
    assert(!flat.includes('akiaiosfodnn7example1'.toLowerCase()), 'SECRET: aws-style key never surfaced');
    assert(!flat.includes('bearer'), 'SECRET: bearer value never surfaced');
    // The safe target still shows.
    assert(flat.includes('portal.acme.com'), 'SECRET: safe host still shown alongside stripped secrets');
  }
  {
    // Secret-shaped value living in a non-secret key name is still scrubbed by value.
    const JWT = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N';
    const lines = buildApprovalScopeLines({ title: `token is ${JWT}` });
    const flat = lines.join('|');
    assert(!flat.includes(JWT), 'SECRET: JWT-shaped value scrubbed even in a safe key');
    assert(flat.includes('[redacted]'), 'SECRET: scrub leaves a [redacted] marker');
  }
  {
    // Secret key detection helper.
    assert(isSecretKeyName('password') && isSecretKeyName('apiKey') && isSecretKeyName('refresh_token'), 'isSecretKeyName positives');
    assert(!isSecretKeyName('category') && !isSecretKeyName('title'), 'isSecretKeyName negatives');
  }
  {
    // A secret key must never become a scope line even if whitelist-ish.
    const lines = buildApprovalScopeLines({ secret: 'topsecretvalue123', title: 'Q3 Launch' });
    assert(!lines.join('|').includes('topsecretvalue123'), 'SECRET: secret-named field never a scope line');
    assert(lines.some((l) => l.includes('Q3 Launch')), 'safe title still shown next to a secret field');
  }

  // ─── 9. Choices set ─────────────────────────────────────────────────
  {
    assert(JSON.stringify(approvalChoicesForTier('read')) === JSON.stringify(['proceed', 'edit']), 'read → proceed+edit only');
    assert(JSON.stringify(approvalChoicesForTier('reversible')) === JSON.stringify(['proceed', 'edit', 'self']), 'reversible → all three');
    assert(JSON.stringify(approvalChoicesForTier('external')) === JSON.stringify(['proceed', 'edit', 'self']), 'external → all three');
    assert(JSON.stringify(approvalChoicesForTier('irreversible')) === JSON.stringify(['proceed', 'edit', 'self']), 'irreversible → all three');
  }
  {
    const p = buildApprovalIntentPreview({ action_type: 'memory.list' });
    assert(!p.choices.includes('self'), 'read approval omits "I\'ll do it myself"');
  }
  {
    const p = buildApprovalIntentPreview({ action_type: 'payments.charge' });
    assert(p.choices.includes('proceed') && p.choices.includes('edit') && p.choices.includes('self'), 'mutating approval offers all three');
  }

  // ─── 10. Degenerate / partial inputs never throw ────────────────────
  {
    const inputs: any[] = [
      undefined,
      null,
      {},
      { action_type: null, reason: null, payload: null },
      { payload: 'not an object' },
      { payload: 42 },
      { payload: ['array', 'payload'] },
      { action_type: '' },
      { action_type: '   ' },
      { action_type: '.' },
      { action_type: 'onlyverb' },
      { reason: '' },
      { payload: { url: 'not a url', method: 12345 } },
      { payload: { url: 'ftp://weird', nested: { deep: { token: 'sk-ant-xxxxxxxxxxxx' } } } },
    ];
    let threw = false;
    let allWellFormed = true;
    for (const input of inputs) {
      try {
        const p = buildApprovalIntentPreview(input);
        if (
          typeof p.intentLine !== 'string' ||
          !p.intentLine.length ||
          !(['read', 'reversible', 'external', 'irreversible'] as ApprovalRiskTier[]).includes(p.riskTier) ||
          !Array.isArray(p.scopeLines) ||
          p.scopeLines.length > 3 ||
          !Array.isArray(p.choices) ||
          !p.choices.length
        ) {
          allWellFormed = false;
        }
      } catch (e) {
        threw = true;
        console.error('threw on input', JSON.stringify(input), e);
      }
    }
    assert(!threw, 'degenerate inputs never throw');
    assert(allWellFormed, 'every degenerate input yields a well-formed preview');
  }
  {
    // Deeply-nested secret is not surfaced (we only read whitelisted top-level keys anyway).
    const p = buildApprovalIntentPreview({
      payload: { nested: { deep: { token: 'sk-ant-abcdefghijklmnop' } } },
    });
    assert(!flatten(p).includes('sk-ant-abcdefghijklmnop'), 'SECRET: nested secret never surfaced');
  }

  // ─── 11. Full preview shape smoke ───────────────────────────────────
  {
    const p = buildApprovalIntentPreview({
      action_type: 'wp.publish_post',
      reason: 'Publishing goes live to the public blog',
      payload: { url: 'https://acme.com/blog', category: 'News', visibility: 'public' },
    });
    assert(p.riskTier === 'external', 'full: publish tier external');
    assert(p.riskChip.tone === 'amber', 'full: external chip amber');
    assert(p.scopeLines.length >= 2, 'full: multiple scope facts');
    assert(p.choices.length === 3, 'full: three choices for external');
  }

  if (failures > 0) {
    console.error(`\n${failures} approval-intent-preview smoke-test failure(s)`);
    process.exit(1);
  }
  console.log('\nAll approval-intent-preview smoke cases passed.');
}

main();
