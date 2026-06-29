/**
 * browser-bridge-smoketest — exercises the pure helpers around the
 * Playwright bridge: tree rendering + dispatcher transform. Offline
 * (no Chrome, no Playwright, no bridge); the real end-to-end path is
 * verified manually against http://localhost:7778/browser/*.
 *
 * Run: npm run smoke:browser-bridge
 */

import { describeBrowserBridgeFailure } from '../src/lib/browserBridgeFailure';

type BrowserA11yNode = {
  id: string;
  role: string;
  name?: string;
  value?: string;
  checked?: boolean | 'mixed';
  pressed?: boolean | 'mixed';
  disabled?: boolean;
  expanded?: boolean;
  selected?: boolean;
  children?: BrowserA11yNode[];
};

function renderBrowserTree(node: BrowserA11yNode, depth = 0, out: string[] = []): string[] {
  const indent = '  '.repeat(depth);
  const parts = [`${indent}[${node.id}]`, node.role];
  if (node.name) parts.push(`"${node.name.replace(/"/g, '\\"').slice(0, 120)}"`);
  if (node.value && node.value !== node.name) parts.push(`= "${String(node.value).replace(/"/g, '\\"').slice(0, 80)}"`);
  const flags: string[] = [];
  if (node.checked === true) flags.push('checked');
  if (node.pressed === true) flags.push('pressed');
  if (node.disabled) flags.push('disabled');
  if (node.selected) flags.push('selected');
  if (node.expanded === false) flags.push('collapsed');
  if (flags.length) parts.push(`(${flags.join(',')})`);
  out.push(parts.join(' '));
  for (const child of node.children || []) {
    renderBrowserTree(child, depth + 1, out);
  }
  return out;
}

// Mirror of describeDomSnapshotTruncation in src/lib/browserBridge.ts:
// when the bridge hit its node budget, the formatted output must end
// with an explicit truncation line so the model narrows scope instead
// of concluding the element doesn't exist.
function describeDomSnapshotTruncation(d: { nodeCount: number; totalNodes?: number; truncated?: boolean }): string | null {
  if (!d.truncated) return null;
  const total = typeof d.totalNodes === 'number' && d.totalNodes > d.nodeCount
    ? String(d.totalNodes)
    : 'more';
  return `[tree truncated: showing ${d.nodeCount} of ${total} nodes — refine with a selector or increase maxNodes]`;
}

function dispatchDomSnapshot(bridgeResult: { ok: boolean; data?: any; error?: string }) {
  if (!bridgeResult.ok || !bridgeResult.data) return bridgeResult;
  const d = bridgeResult.data;
  const lines = renderBrowserTree(d.tree);
  const trailer = describeDomSnapshotTruncation(d);
  if (trailer) lines.push(trailer);
  const text = lines.join('\n');
  return {
    ok: true,
    data: {
      url: d.url,
      title: d.title,
      nodeCount: d.nodeCount,
      totalNodes: typeof d.totalNodes === 'number' ? d.totalNodes : d.nodeCount,
      snapshotTruncated: !!d.truncated,
      text: text.slice(0, 8192),
      truncated: text.length > 8192,
    },
  };
}

function dispatchScreenshot(bridgeResult: { ok: boolean; data?: any; error?: string }) {
  if (!bridgeResult.ok || !bridgeResult.data) return bridgeResult;
  const d = bridgeResult.data;
  const preview = d.base64.slice(0, 128) + '…';
  return { ok: true, data: { mimeType: d.mimeType, sizeBytes: d.sizeBytes, preview } };
}

// ─── Runner ─────────────────────────────────────────────────────────
let failures = 0;
function fail(m: string) { failures += 1; console.error('FAIL:', m); }
function pass(m: string) { console.log('pass:', m); }
function assert(cond: unknown, name: string, detail?: string) {
  if (cond) pass(name); else fail(`${name}${detail ? ' — ' + detail : ''}`);
}

function main() {
  // ─── Tree render ───────────────────────────────────────────────
  {
    const tree: BrowserA11yNode = {
      id: '0',
      role: 'main',
      children: [
        { id: '0.0', role: 'heading', name: 'Example Domain' },
        { id: '0.1', role: 'link', name: 'More information' },
        { id: '0.2', role: 'textbox', name: 'Search', value: 'query', disabled: false },
        { id: '0.3', role: 'checkbox', name: 'Agree', checked: true },
        { id: '0.4', role: 'button', name: 'Submit', disabled: true },
      ],
    };
    const lines = renderBrowserTree(tree);
    assert(lines.length === 6, 'render: one line per node');
    assert(lines[1].includes('[0.0] heading "Example Domain"'), 'render: heading');
    assert(lines[2].includes('[0.1] link "More information"'), 'render: link');
    assert(lines[3].includes('= "query"'), 'render: value on textbox');
    assert(lines[4].includes('(checked)'), 'render: checked flag');
    assert(lines[5].includes('(disabled)'), 'render: disabled flag');
  }

  // Name truncation + escaping
  {
    const longName = 'a'.repeat(500);
    const tree: BrowserA11yNode = { id: '0', role: 'link', name: longName };
    const line = renderBrowserTree(tree)[0];
    assert(line.length < 200, 'render: long name capped');
  }
  {
    const tree: BrowserA11yNode = { id: '0', role: 'button', name: 'He said "hi"' };
    const line = renderBrowserTree(tree)[0];
    assert(line.includes('\\"hi\\"'), 'render: quotes escaped');
  }

  // ─── Dispatcher dom_snapshot ───────────────────────────────────
  {
    const fakeBridgeOk = {
      ok: true,
      data: {
        url: 'https://example.com/',
        title: 'Example Domain',
        nodeCount: 3,
        tree: {
          id: '0',
          role: 'main',
          children: [
            { id: '0.0', role: 'heading', name: 'Example Domain' },
            { id: '0.1', role: 'link', name: 'Learn more' },
          ],
        } as BrowserA11yNode,
      },
    };
    const r = dispatchDomSnapshot(fakeBridgeOk);
    assert(r.ok, 'dispatch: happy path');
    assert((r as any).data.url === 'https://example.com/', 'dispatch: url passthrough');
    assert((r as any).data.title === 'Example Domain', 'dispatch: title passthrough');
    assert((r as any).data.nodeCount === 3, 'dispatch: nodeCount passthrough');
    assert((r as any).data.text.split('\n').length === 3, 'dispatch: 3 rendered lines');
    assert((r as any).data.truncated === false, 'dispatch: not truncated');
  }

  // Huge tree: rendered text trimmed
  {
    const kids: BrowserA11yNode[] = [];
    for (let i = 0; i < 500; i++) {
      kids.push({ id: `0.${i}`, role: 'button', name: `Button number ${i} with label text` });
    }
    const fake = { ok: true, data: { url: 'https://x/', title: 'X', nodeCount: 500, tree: { id: '0', role: 'main', children: kids } } };
    const r = dispatchDomSnapshot(fake);
    assert((r as any).data.text.length === 8192, 'dispatch: text capped at 8KB');
    assert((r as any).data.truncated === true, 'dispatch: truncated flag set');
  }

  // Error passthrough
  {
    const fake = { ok: false, error: 'bridge offline' };
    const r = dispatchDomSnapshot(fake);
    assert(!r.ok, 'dispatch: error path');
    assert(r.error === 'bridge offline', 'dispatch: error text');
  }

  // ─── Snapshot truncation flag + explicit trailer line ───────────
  {
    const fake = {
      ok: true,
      data: {
        url: 'https://big.example/',
        title: 'Big page',
        nodeCount: 150,
        totalNodes: 1200,
        truncated: true,
        tree: { id: '0', role: 'main', children: [{ id: '0.0', role: 'heading', name: 'Big' }] } as BrowserA11yNode,
      },
    };
    const r = dispatchDomSnapshot(fake);
    assert((r as any).data.snapshotTruncated === true, 'truncation: flag surfaced');
    assert((r as any).data.totalNodes === 1200, 'truncation: totalNodes surfaced');
    const lastLine = (r as any).data.text.split('\n').pop();
    assert(
      lastLine === '[tree truncated: showing 150 of 1200 nodes — refine with a selector or increase maxNodes]',
      'truncation: formatted output ends with explicit trailer',
      lastLine,
    );
  }
  {
    // truncated:true but totalNodes missing (older bridge): "of more".
    const note = describeDomSnapshotTruncation({ nodeCount: 150, truncated: true });
    assert(note === '[tree truncated: showing 150 of more nodes — refine with a selector or increase maxNodes]', 'truncation: missing totalNodes degrades to "more"', String(note));
  }
  {
    // Complete snapshot: no trailer at all.
    const fake = {
      ok: true,
      data: {
        url: 'https://small.example/',
        title: 'Small',
        nodeCount: 3,
        totalNodes: 3,
        truncated: false,
        tree: { id: '0', role: 'main', children: [{ id: '0.0', role: 'heading', name: 'Small' }] } as BrowserA11yNode,
      },
    };
    const r = dispatchDomSnapshot(fake);
    assert(!(r as any).data.text.includes('[tree truncated'), 'truncation: complete snapshot has no trailer');
    assert((r as any).data.snapshotTruncated === false, 'truncation: complete snapshot flag false');
    assert(describeDomSnapshotTruncation({ nodeCount: 3, totalNodes: 3, truncated: false }) === null, 'truncation: helper returns null when complete');
  }

  // ─── Pre-mutation verification-gate auto-check ───────────────────
  //
  // Mirror of preMutationVerificationGate in src/lib/browserBridge.ts:
  // mutating actions (click/fill/select/upload) consult
  // verificationState() first; a detected gate blocks the action with
  // a structured `verification_gate` error that tells the model to
  // hand the gate to the user (never bypass). `skipVerificationCheck`
  // proceeds; a failed check fails OPEN because the bridge server
  // still runs its own guard before mutating.
  {
    const HINT = 'pause and ask the user to complete it — do not attempt to bypass';
    type VState = { ok: boolean; data?: { verificationDetected?: boolean; gate?: { kind?: string; label?: string } | null; url?: string } };
    const decideGate = (state: VState, skipVerificationCheck?: boolean) => {
      if (skipVerificationCheck === true) return null;
      if (!state.ok || !state.data?.verificationDetected) return null;
      const kind = String(state.data.gate?.kind || 'verification');
      const label = String(state.data.gate?.label || 'Human verification');
      return {
        ok: false as const,
        error: `verification_gate: ${label} detected on ${state.data.url || 'the current page'} — ${HINT}.`,
        errorCode: 'verification_gate' as const,
        verificationGate: { kind, label, hint: HINT },
      };
    };

    const gated: VState = {
      ok: true,
      data: { verificationDetected: true, gate: { kind: 'captcha', label: 'CAPTCHA / human verification' }, url: 'https://login.example/' },
    };
    const blocked = decideGate(gated);
    assert(blocked !== null, 'verification gate: detected gate blocks the mutation');
    assert(blocked!.errorCode === 'verification_gate', 'verification gate: structured errorCode');
    assert(blocked!.verificationGate.kind === 'captcha', 'verification gate: kind passthrough');
    assert(blocked!.error.includes('do not attempt to bypass'), 'verification gate: hint forbids bypass');
    assert(blocked!.error.includes('https://login.example/'), 'verification gate: names the gated page');

    assert(decideGate(gated, true) === null, 'verification gate: skipVerificationCheck proceeds');
    assert(decideGate({ ok: true, data: { verificationDetected: false } }) === null, 'verification gate: clean page proceeds');
    assert(decideGate({ ok: false }) === null, 'verification gate: check failure fails open (server still guards)');
    const mfa = decideGate({ ok: true, data: { verificationDetected: true, gate: { kind: 'mfa', label: 'MFA / one-time verification code' } } });
    assert(mfa !== null && mfa.verificationGate.kind === 'mfa', 'verification gate: mfa kind surfaced');
    const bare = decideGate({ ok: true, data: { verificationDetected: true, gate: null } });
    assert(bare !== null && bare.verificationGate.kind === 'verification', 'verification gate: missing gate detail degrades to generic kind');
  }

  // ─── ambiguous_locator passthrough (callBrowser mirror) ─────────
  //
  // Mirror of the callBrowser ok:false branch in src/lib/browserBridge.ts:
  // the structured ambiguity payload must survive verbatim instead of
  // being flattened by the generic failure classifier.
  {
    const normalizeAmbiguousCandidates = (value: unknown) => {
      if (!Array.isArray(value)) return undefined;
      const candidates = value
        .filter((item) => item && typeof item === 'object')
        .slice(0, 5)
        .map((item: any) => {
          const candidate: { role: string; name?: string; snippet?: string } = { role: String(item.role || 'unknown').slice(0, 60) };
          if (typeof item.name === 'string' && item.name) candidate.name = item.name.slice(0, 120);
          if (typeof item.snippet === 'string' && item.snippet) candidate.snippet = item.snippet.slice(0, 120);
          return candidate;
        });
      return candidates.length > 0 ? candidates : undefined;
    };
    const passthrough = (json: any) => {
      if (json?.errorCode === 'ambiguous_locator') {
        return {
          ok: false as const,
          error: typeof json.error === 'string' ? json.error : 'ambiguous locator',
          errorCode: 'ambiguous_locator' as const,
          matches: Number.isFinite(Number(json.matches)) ? Number(json.matches) : undefined,
          candidates: normalizeAmbiguousCandidates(json.candidates),
        };
      }
      return null; // would fall through to describeBrowserBridgeFailure
    };

    const r = passthrough({
      ok: false,
      errorCode: 'ambiguous_locator',
      error: 'ambiguous locator: 3 elements match "Edit". Pass nth (0-based) or a more specific selector to disambiguate.',
      matches: 3,
      candidates: [
        { role: 'button', name: 'Edit profile', snippet: 'Edit' },
        { role: 'button', name: 'Edit billing', snippet: 'Edit' },
        { role: 'link', snippet: 'Edit settings' },
      ],
    });
    assert(r !== null, 'ambiguous passthrough: structured branch taken');
    assert(r!.errorCode === 'ambiguous_locator', 'ambiguous passthrough: code preserved (not reclassified)');
    assert(r!.matches === 3, 'ambiguous passthrough: matches preserved');
    assert(r!.candidates!.length === 3, 'ambiguous passthrough: candidates preserved');
    assert(r!.candidates![2].role === 'link' && !('name' in r!.candidates![2]), 'ambiguous passthrough: nameless candidate keeps role only');
    assert(passthrough({ ok: false, errorCode: 'timeout', error: 'Timeout' }) === null, 'ambiguous passthrough: other codes use the classifier path');
  }

  // ─── Screenshot dispatch ────────────────────────────────────────
  {
    const fakeBridge = {
      ok: true,
      data: { mimeType: 'image/png', sizeBytes: 54321, base64: 'iVBORw0KGgoAAA'.repeat(500) },
    };
    const r = dispatchScreenshot(fakeBridge);
    assert(r.ok, 'screenshot: happy path');
    assert((r as any).data.preview.endsWith('…'), 'screenshot: preview truncated w/ ellipsis');
    assert((r as any).data.preview.length <= 130, 'screenshot: preview ≤130 chars');
    assert((r as any).data.sizeBytes === 54321, 'screenshot: sizeBytes preserved');
  }

  // ─── URL scheme validation (mirrors dispatchBrowserOpenUrl) ────
  const validateUrl = (u: string) => /^https?:\/\//i.test(String(u || '').trim());
  assert(validateUrl('https://example.com'), 'url: https ok');
  assert(validateUrl('HTTP://Example.com'), 'url: case-insensitive scheme ok');
  assert(!validateUrl('javascript:alert(1)'), 'url: js: scheme rejected');
  assert(!validateUrl('file:///etc/passwd'), 'url: file: scheme rejected');
  assert(!validateUrl(''), 'url: empty rejected');
  assert(!validateUrl('example.com'), 'url: missing scheme rejected');

  // Browser failure classification: the chat recovery path should see
  // deterministic failure classes, not raw Playwright text only.
  {
    const failure = describeBrowserBridgeFailure('Timeout 5000ms exceeded while waiting for locator("button").click()');
    assert(failure.errorCode === 'selector_not_found', 'failure: Playwright timeout maps to selector recovery');
    assert(failure.message.includes('fresh DOM snapshot'), 'failure: selector recovery names fresh DOM evidence');
    assert(failure.requiredEvidence.includes('browser.dom_snapshot'), 'failure: selector recovery requires DOM evidence');
    assert(failure.requiredEvidence.includes('browser.screenshot'), 'failure: selector recovery requires screenshot evidence');
  }
  {
    const failure = describeBrowserBridgeFailure('page.goto: Timeout 30000ms exceeded while waiting for load');
    assert(failure.errorCode === 'timeout', 'failure: navigation timeout maps to bounded timeout recovery');
    assert(failure.message.includes('current URL'), 'failure: timeout recovery asks for current page evidence');
    assert(failure.requiredEvidence.includes('browser.health'), 'failure: timeout recovery requires browser health');
    assert(failure.message.includes('Evidence: browser.health'), 'failure: user/agent message includes evidence plan');
  }
  {
    const failure = describeBrowserBridgeFailure('locator.click: Error: strict mode violation: resolved to 2 elements');
    assert(failure.errorCode === 'uncertain_ui_target', 'failure: strict-mode ambiguity maps to UI target recovery');
    assert(failure.message.includes('ask for confirmation'), 'failure: ambiguity recovery can ask for confirmation');
  }
  {
    const failure = describeBrowserBridgeFailure('Token rejected.', 'token_rejected');
    assert(failure.errorCode === 'token_rejected', 'failure: explicit token rejection is preserved');
    assert(failure.message.includes('Re-pair'), 'failure: token recovery asks for re-pairing');
  }
  {
    const failure = describeBrowserBridgeFailure('Cloudflare security check requires human verification.');
    assert(failure.errorCode === 'human_verification_required', 'failure: human verification is protected');
    assert(failure.message.includes('Pause automation'), 'failure: human verification pauses automation');
    assert(failure.requiredEvidence.includes('user.complete_browser_verification'), 'failure: human verification requires user evidence');
  }
  {
    const failure = describeBrowserBridgeFailure('Browser dialog blocked: "lmao.png" already exists. Decision: requested output not confirmed.');
    assert(failure.errorCode === 'browser_dialog_blocked', 'failure: browser popup maps to dialog recovery');
    assert(failure.requiredEvidence.includes('browser.dialog_observation'), 'failure: browser popup requires dialog observation');
    assert(failure.message.includes('guarded modal advisor'), 'failure: browser popup recovery names modal advisor');
  }

  // App-side bridge result shape: later recovery code should not parse
  // prose to know which evidence is required.
  {
    const failure = describeBrowserBridgeFailure('Token rejected.', 'token_rejected');
    const bridgeResult = {
      ok: false,
      error: failure.message,
      errorCode: failure.errorCode,
      recoveryHint: failure.recoveryHint,
      requiredEvidence: failure.requiredEvidence,
    };
    assert(bridgeResult.requiredEvidence.includes('desktop.bridge_pairing'), 'failure result: pairing evidence is structured');
    assert(bridgeResult.recoveryHint.includes('Re-pair'), 'failure result: recovery hint is structured');
  }

  // Explicit ambiguous_locator code must now be preserved (not reclassified)
  // and carry its dedicated hint, evidence, and retryability.
  {
    const failure = describeBrowserBridgeFailure(
      'ambiguous locator: 3 elements match "Edit". Pass nth (0-based) or a more specific selector.',
      'ambiguous_locator',
    );
    assert(failure.errorCode === 'ambiguous_locator', 'failure: explicit ambiguous_locator preserved');
    assert(failure.recoveryHint.includes('nth'), 'failure: ambiguous recovery names nth disambiguation', failure.recoveryHint);
    assert(failure.requiredEvidence.includes('browser.candidate_list'), 'failure: ambiguous requires candidate list', failure.requiredEvidence.join(','));
    assert(failure.retryability === 'retry_after_evidence', 'failure: ambiguous retries after evidence', String(failure.retryability));
  }
  {
    const failure = describeBrowserBridgeFailure('Cloudflare security check requires human verification.');
    assert(failure.retryability === 'needs_user', 'failure: human verification needs user', String(failure.retryability));
  }
  {
    const failure = describeBrowserBridgeFailure('page.goto: Timeout 30000ms exceeded while waiting for load');
    assert(failure.retryability === 'retry_once', 'failure: navigation timeout retries once', String(failure.retryability));
  }
  {
    const failure = describeBrowserBridgeFailure('verification_gate detected', 'verification_gate');
    assert(failure.errorCode === 'verification_gate', 'failure: verification_gate preserved');
    assert(failure.requiredEvidence.includes('user.complete_browser_verification'), 'failure: verification_gate requires user evidence');
  }

  if (failures > 0) {
    console.error(`\n${failures} browser-bridge smoke-test failure(s)`);
    process.exit(1);
  }
  console.log('\nAll browser-bridge smoke cases passed.');
}

main();
