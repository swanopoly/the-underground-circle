/**
 * browser-bridge-smoketest — exercises the pure helpers around the
 * Playwright bridge: tree rendering + dispatcher transform. Offline
 * (no Chrome, no Playwright, no bridge); the real end-to-end path is
 * verified manually against http://localhost:7778/browser/*.
 *
 * Run: npm run smoke:browser-bridge
 */

import { describeBrowserBridgeFailure } from '../src/lib/browserBridgeFailure';
import { readFileSync } from 'fs';

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
      browserProcessId: d.browserProcessId,
      browserContextId: d.browserContextId,
      pageId: d.pageId,
      url: d.url,
      observedAt: d.observedAt,
      evidenceId: d.evidenceId,
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
        browserProcessId: 'uc_browser_process_fixture_1',
        browserContextId: 'uc_browser_context_fixture_2',
        pageId: 'uc_browser_page_fixture_3',
        url: 'https://example.com/',
        observedAt: '2026-07-24T12:00:00.000Z',
        evidenceId: 'uc_browser_evidence_fixture_4',
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
    assert((r as any).data.browserProcessId === 'uc_browser_process_fixture_1', 'dispatch: process identity passthrough');
    assert((r as any).data.browserContextId === 'uc_browser_context_fixture_2', 'dispatch: context identity passthrough');
    assert((r as any).data.pageId === 'uc_browser_page_fixture_3', 'dispatch: page identity passthrough');
    assert((r as any).data.evidenceId === 'uc_browser_evidence_fixture_4', 'dispatch: evidence identity passthrough');
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

  // ─── Guarded fill identity + redaction source contract ─────────
  //
  // The live handler is Playwright-bound, so this offline smoke pins the
  // exact server/client chokepoints while browser-primitives-smoketest
  // exercises the exported identity/check/proof helpers with fake live pages.
  {
    const bridgeSource = readFileSync(new URL('./browser-bridge.js', import.meta.url), 'utf8');
    const bridgeRouterSource = readFileSync(new URL('./claude-bridge.js', import.meta.url), 'utf8');
    const clientSource = readFileSync(new URL('../src/lib/browserBridge.ts', import.meta.url), 'utf8');
    const runtimeSource = readFileSync(new URL('../src/lib/openswanToolRuntime.ts', import.meta.url), 'utf8');
    // Loading browserBridge.ts directly pulls React Native into this Node-only
    // smoke. Transpile/evaluate only its pure extractor slice so these are
    // behavioral tests of the production functions without app-runtime side
    // effects or a duplicate test implementation.
    const clientExtractorStart = clientSource.indexOf('function isBoundedOpaqueBrowserId(');
    const clientExtractorEnd = clientSource.indexOf('\n// ─── Calls', clientExtractorStart);
    const typescript = require('typescript') as typeof import('typescript');
    const extractorModule = { exports: {} as Record<string, (value: unknown) => any> };
    const extractorJavaScript = typescript.transpileModule(
      clientSource.slice(clientExtractorStart, clientExtractorEnd),
      {
        compilerOptions: {
          module: typescript.ModuleKind.CommonJS,
          target: typescript.ScriptTarget.ES2020,
        },
      },
    ).outputText;
    new Function('exports', 'module', extractorJavaScript)(
      extractorModule.exports,
      extractorModule,
    );
    const extractBrowserGuardedFillTarget = extractorModule.exports.extractBrowserGuardedFillTarget;
    const extractBrowserFillProofMetadata = extractorModule.exports.extractBrowserFillProofMetadata;
    assert(
      clientExtractorStart >= 0
        && clientExtractorEnd > clientExtractorStart
        && typeof extractBrowserGuardedFillTarget === 'function'
        && typeof extractBrowserFillProofMetadata === 'function',
      'fill client extractors: production pure functions load in the offline smoke',
    );
    const observeStart = bridgeSource.indexOf('async function handleObserveGuardedFillTarget(');
    const fillStart = bridgeSource.indexOf('async function handleFill(');
    const fillEnd = bridgeSource.indexOf('\nasync function handleSelect(', fillStart);
    const observeSource = bridgeSource.slice(observeStart, fillStart);
    const fillSource = bridgeSource.slice(fillStart, fillEnd);

    assert(observeStart >= 0 && fillStart > observeStart, 'fill target source: observation handler found');
    assert(fillStart >= 0 && fillEnd > fillStart, 'fill canary source: handler found');
    assert(
      bridgeSource.includes('handleObserveGuardedFillTarget,')
        && bridgeRouterSource.includes("p === '/browser/fill_target'")
        && bridgeRouterSource.includes('browserBridge.handleObserveGuardedFillTarget'),
      'fill target route: authenticated bridge route reaches the exported observation handler',
    );
    assert(
      bridgeRouterSource.indexOf("const token = req.headers['x-uc-desktop-token']")
        < bridgeRouterSource.indexOf("p === '/browser/fill_target'"),
      'fill target route: desktop-token authentication precedes target capability issuance',
    );
    assert(
      observeSource.includes('body.text != null')
        && observeSource.includes('body.submit != null'),
      'fill target observation: text and submit authority are rejected before browser setup',
    );
    assert(
      observeSource.includes('!hasExactlyOneGuardedFillLocator(body)')
        && observeSource.indexOf('!hasExactlyOneGuardedFillLocator(body)')
          < observeSource.indexOf('await ensureContext()'),
      'fill target observation: name XOR selector is enforced before browser setup',
    );
    assert(
      observeSource.includes('matchCount !== 1')
        && observeSource.indexOf('matchCount !== 1') < observeSource.indexOf('locator.elementHandle'),
      'fill target observation: exactly one element is required before issuing authority',
    );
    const observeHandle = observeSource.indexOf('locator.elementHandle');
    const observeInspection = observeSource.indexOf('inspectResolvedFillTarget(targetHandle)');
    const observeStartingIdentity = observeSource.indexOf('checkExpectedBrowserFillIdentity(');
    const observeFinalIdentity = observeSource.indexOf(
      'checkExpectedBrowserFillIdentity(',
      observeInspection + 1,
    );
    const observeFingerprint = observeSource.indexOf('buildGuardedTargetFingerprint(');
    const observeIssue = observeSource.indexOf('guardedTargetCapabilities.issue(');
    assert(
      observeStartingIdentity >= 0
        && observeStartingIdentity < observeHandle
        && observeHandle < observeInspection
        && observeInspection < observeFinalIdentity
        && observeFinalIdentity < observeFingerprint
        && observeFingerprint < observeIssue,
      'fill target observation: prior identity gates resolution, then exact handle is rechecked, fingerprinted, and issued',
    );
    assert(
      observeSource.includes('targetHandle = null; // ownership transferred')
        && observeSource.includes('await targetHandle.dispose()'),
      'fill target observation: ownership transfer and failure disposal are explicit',
    );
    const descriptorStart = bridgeSource.indexOf('async function inspectResolvedFillTarget(');
    const descriptorEnd = bridgeSource.indexOf('\nfunction buildGuardedTargetFingerprint(', descriptorStart);
    const descriptorSource = bridgeSource.slice(descriptorStart, descriptorEnd);
    assert(
      descriptorSource.includes("ariaLabelledByText: referencedText('aria-labelledby')")
        && descriptorSource.includes("ariaDescribedByText: referencedText('aria-describedby')")
        && descriptorSource.includes('getAttribute(attribute)'),
      'fill target inspection: external aria-labelledby text is resolved from the live element',
    );
    assert(
      descriptorSource.includes('nodeStructure:')
        && descriptorSource.includes('frameStructure:')
        && descriptorSource.includes('documentUrl:')
        && descriptorSource.includes('isConnected:')
        && descriptorSource.includes('ownerDocumentIsCurrent:'),
      'fill target inspection: exact node, frame, document, and attachment state share one renderer capture',
    );
    const fingerprintStart = bridgeSource.indexOf('function buildGuardedTargetFingerprint(');
    const fingerprintEnd = bridgeSource.indexOf('\nfunction isCoherentBrowserPageIdentity(', fingerprintStart);
    const fingerprintSource = bridgeSource.slice(fingerprintStart, fingerprintEnd);
    for (const field of [
      'ariaDescribedByText',
      'formText',
      'documentUrl',
      'nodeStructure',
      'frameStructure',
      'isConnected',
      'ownerDocumentIsCurrent',
    ]) {
      assert(
        fingerprintSource.includes(field),
        `fill target fingerprint: inspected ${field} participates in the keyed binding`,
      );
    }
    assert(
      fingerprintSource.includes("createHmac('sha256', guardedTargetFingerprintKey)")
        && fingerprintSource.includes("'guarded-target-structure-v1\\0'")
        && fingerprintSource.includes('structuralDigest'),
      'fill target fingerprint: frame/node structure is reduced through a process-keyed digest',
    );
    assert(
      fillSource.indexOf("const guardedNonSecret = body.fillMode === 'guarded_non_secret'") >= 0,
      'fill canary source: guarded non-secret mode is explicit',
    );
    assert(
      fillSource.includes('hasGuardedFillLocatorOverride(body)')
        && fillSource.indexOf('hasGuardedFillLocatorOverride(body)')
          < fillSource.indexOf('await ensureContext()'),
      'fill canary source: locator overrides are rejected before target consumption or mutation',
    );
    assert(
      fillSource.indexOf('guardedNonSecret && body.submit === true') >= 0
        && fillSource.indexOf('guardedNonSecret && body.submit === true') < fillSource.indexOf('await ensureContext()'),
      'fill canary source: guarded submit semantics stop before browser mutation setup',
    );
    assert(
      fillSource.indexOf('guardedNonSecret && isCredentialFillSemantics(body)') >= 0
        && fillSource.indexOf('guardedNonSecret && isCredentialFillSemantics(body)') < fillSource.indexOf('await ensureContext()'),
      'fill canary source: guarded credential semantics stop before browser mutation setup',
    );
    assert(
      fillSource.indexOf('guardedNonSecret && isSecretBearingFillText(text)') >= 0
        && fillSource.indexOf('guardedNonSecret && isSecretBearingFillText(text)') < fillSource.indexOf('await ensureContext()')
        && !fillSource.includes('`browser fill canary refuses secret-bearing draft text: ${text}`'),
      'fill canary source: secret-bearing draft text is rejected before browser setup without echoing it',
    );
    const capabilityStart = fillSource.indexOf('const consumed = guardedTargetCapabilities.consume(body.targetId)');
    const capabilityEnd = fillSource.indexOf('\n    let locator = resolveLocator(', capabilityStart);
    const capabilitySource = fillSource.slice(capabilityStart, capabilityEnd);
    const targetRecordCheck = capabilitySource.indexOf('targetRecord.contextRef !== launched.context');
    const exactEntryCheck = capabilitySource.indexOf('checkExpectedBrowserFillIdentity(');
    const resolvedTargetCheck = capabilitySource.indexOf('await inspectResolvedFillTarget(targetHandle)');
    const handlerFingerprint = capabilitySource.indexOf('buildGuardedTargetFingerprint(');
    const preMutationValueCheck = capabilitySource.indexOf('currentValue = await targetHandle.inputValue({ timeout })');
    const handleFill = capabilitySource.indexOf('await targetHandle.fill(text, { timeout })');
    const coherentCapture = capabilitySource.indexOf('await captureCoherentGuardedFillObservation({');
    const proofBuild = capabilitySource.indexOf('buildRedactedBrowserFillProofFromObservation(');
    assert(
      capabilityStart >= 0 && capabilityEnd > capabilityStart,
      'fill canary source: sealed target-capability branch found',
    );
    assert(
      targetRecordCheck >= 0 && targetRecordCheck > 0,
      'fill canary source: capability is consumed before attacker-controlled fingerprint/identity comparisons',
    );
    assert(
      targetRecordCheck < exactEntryCheck
        && exactEntryCheck < resolvedTargetCheck
        && resolvedTargetCheck < handlerFingerprint
        && handlerFingerprint < preMutationValueCheck
        && preMutationValueCheck < handleFill,
      'fill canary source: consumed exact handle is identity-checked, re-inspected, fingerprinted, then checked before fill',
    );
    assert(
      capabilitySource.includes('const mutationPerformed = currentValue !== text')
        && capabilitySource.includes('if (mutationPerformed)')
        && preMutationValueCheck < handleFill,
      'fill canary source: an outcome-unknown retry proves an already-matching value without dispatching fill twice',
    );
    assert(
      handleFill < coherentCapture
        && coherentCapture < proofBuild
        && !capabilitySource.slice(handleFill, coherentCapture).includes('inputValue('),
      'fill canary source: completion uses one coherent exact-handle observation, not a stale standalone value read',
    );
    const coherentStart = bridgeSource.indexOf('async function captureCoherentGuardedFillObservation(');
    const coherentEnd = bridgeSource.indexOf('\nfunction classifyBrowserFailure(', coherentStart);
    const coherentSource = bridgeSource.slice(coherentStart, coherentEnd);
    assert(
      coherentStart >= 0
        && coherentEnd > coherentStart
        && coherentSource.indexOf('const identity = registry.observe(')
          < coherentSource.indexOf('await inspectResolvedFillTarget(targetHandle, { includeValue: true, timeout })')
        && coherentSource.indexOf('await inspectResolvedFillTarget(targetHandle, { includeValue: true, timeout })')
          < coherentSource.indexOf('const exitCheck = checkExpectedBrowserFillIdentity(')
        && coherentSource.includes('state.descriptor.documentUrl !== identity.url')
        && coherentSource.includes('targetFingerprint !== expectedTargetFingerprint'),
      'fill proof coherence: evidence identity brackets one value/semantic/structure capture and any drift fails closed',
    );
    assert(
      capabilitySource.includes('buildRedactedBrowserFillProofFromObservation(')
        && !capabilitySource.includes('buildRedactedBrowserFillProof(\n          browserIdentities'),
      'fill proof coherence: production proof consumes the coherent observation without minting later evidence',
    );
    assert(
      capabilitySource.includes('finally {')
        && capabilitySource.includes('await targetHandle.dispose()'),
      'fill canary source: consumed handle is disposed on every terminal path',
    );
    assert(fillSource.includes('res.end(JSON.stringify({ ok: true, ...proof }))'), 'fill canary source: successful response returns the redacted proof object');
    assert(fillSource.includes('if (guardedNonSecret) {'), 'fill canary source: proof path is isolated behind guarded mode');
    assert(fillSource.includes('chars: text.length'), 'fill compatibility: legacy character-count response retained');
    assert(fillSource.includes('submitted: !!body.submit'), 'fill compatibility: legacy optional-submit response retained');
    assert(
      fillSource.indexOf('res.end(JSON.stringify({ ok: true, ...proof }))')
        < fillSource.indexOf('chars: text.length'),
      'fill compatibility: guarded proof returns before legacy response',
    );

    for (const name of [
      'browserProcessId',
      'browserContextId',
      'pageId',
      'url',
      'observedAt',
      'evidenceId',
      'expectedBrowserContextId',
      'expectedPageId',
      'expectedUrl',
      'valueMatches',
      'valueLength',
      'expectedLength',
      'mutationPerformed',
      'targetId',
      'targetFingerprint',
      'targetExpiresAt',
    ]) {
      assert(bridgeSource.includes(name) && clientSource.includes(name), `fill canary contract: ${name} is shared by bridge and client`);
    }
    assert(clientSource.includes('export interface BrowserPageIdentity'), 'fill canary client: BrowserPageIdentity exported');
    assert(clientSource.includes('export interface BrowserGuardedFillTarget'), 'fill canary client: guarded target contract exported');
    assert(clientSource.includes('export interface BrowserFillProof'), 'fill canary client: BrowserFillProof exported');
    assert(clientSource.includes('export async function observeGuardedNonSecretFillTarget'), 'fill canary client: target observation export exists');
    assert(clientSource.includes('export async function fillGuardedNonSecretField'), 'fill canary client: explicit guarded export exists');
    assert(clientSource.includes('export function extractBrowserGuardedFillTarget'), 'fill canary client: bounded target extractor exported');
    assert(clientSource.includes('export function extractBrowserFillProofMetadata'), 'fill canary client: bounded metadata extractor exported');
    assert(clientSource.includes("fillMode: 'guarded_non_secret'"), 'fill canary client: guarded export selects only the sealed server mode');
    const legacyFillStart = clientSource.indexOf('export async function fillField');
    const legacyFillEnd = clientSource.indexOf('export interface BrowserGuardedFillTargetArgs', legacyFillStart);
    const guardedFillStart = clientSource.indexOf('export async function fillGuardedNonSecretField');
    const legacyFillSource = clientSource.slice(legacyFillStart, legacyFillEnd);
    assert(legacyFillSource.includes('submit?: boolean'), 'fill compatibility client: legacy submit input retained');
    assert(legacyFillSource.includes("BrowserActionResult<{ chars: number }>"),
      'fill compatibility client: legacy chars result retained');
    assert(!legacyFillSource.includes('expectedBrowserContextId'), 'fill compatibility client: legacy callers do not require canary identity arguments');
    const guardedContractStart = clientSource.indexOf('export interface BrowserGuardedFillTargetArgs');
    const guardedContractEnd = clientSource.indexOf('function hasCredentialFillSignals', guardedContractStart);
    const guardedContractSource = clientSource.slice(guardedContractStart, guardedContractEnd);
    const guardedFillEnd = clientSource.indexOf('\n/** Select an option', guardedFillStart);
    const guardedClientSource = clientSource.slice(guardedFillStart, guardedFillEnd);
    assert(
      guardedContractSource.includes('extends BrowserPageIdentityExpectation'),
      'fill canary client: exact context/page/URL expectation is required by contract',
    );
    assert(guardedContractSource.includes('targetId: string'), 'fill canary client: exact target capability is required');
    assert(guardedContractSource.includes('targetFingerprint: string'), 'fill canary client: approved target fingerprint is required');
    assert(!guardedContractSource.includes('nth?: number'), 'fill target client: ambiguous nth authority is not accepted');
    assert(!guardedClientSource.includes('await domSnapshot('), 'fill canary client: missing identity is never silently refreshed');
    assert(bridgeSource.includes("newPage.on('framenavigated'"), 'fill identity: main-frame navigation listener exists');
    assert(bridgeSource.includes('browserIdentities.advancePageDocument(newPage)'), 'fill identity: navigation rotates page id even when URL is unchanged');
    const trackingStart = bridgeSource.indexOf('function trackContextPages(');
    const trackingEnd = bridgeSource.indexOf('\nfunction activePage(', trackingStart);
    const trackingSource = bridgeSource.slice(trackingStart, trackingEnd);
    assert(
      trackingSource.indexOf("newPage.on('framenavigated'")
        < trackingSource.indexOf('browserIdentities.advancePageDocument(newPage)')
        && trackingSource.includes('guardedTargetCapabilities.revokeWhere('),
      'fill target lifecycle: navigation revokes capabilities before document identity rotates',
    );
    assert(
      trackingSource.includes("newPage.on('close'")
        && trackingSource.includes('(record) => record.pageRef === newPage')
        && trackingSource.includes('browserIdentities.retirePage(newPage)'),
      'fill target lifecycle: page close revokes capabilities and retires identity',
    );
    assert(
      trackingSource.includes("ctx.on('close'")
        && trackingSource.includes('(record) => record.contextRef === ctx')
        && trackingSource.includes('browserIdentities.retireContext(ctx)'),
      'fill target lifecycle: context close revokes every owned capability',
    );
    const extractorStart = clientSource.indexOf('export function extractBrowserFillProofMetadata');
    const extractorEnd = clientSource.indexOf('\n// ─── Calls', extractorStart);
    const extractorSource = clientSource.slice(extractorStart, extractorEnd);
    assert(!extractorSource.includes('.text'), 'fill proof extractor: filled text is never inspected or returned');
    assert(!extractorSource.includes('.value,'), 'fill proof extractor: observed value is never inspected or returned');
    assert(
      runtimeSource.includes('observeGuardedNonSecretFillTarget')
        && runtimeSource.includes('targetFingerprint'),
      'fill runtime: approval preparation observes an exact target and binds its fingerprint',
    );
    const preparedContractStart = runtimeSource.indexOf('type PreparedGuardedBrowserFill =');
    const approvalContractStart = runtimeSource.indexOf('approvalArgs: {', preparedContractStart);
    const approvalContractEnd = runtimeSource.indexOf('beforeEpoch:', approvalContractStart);
    const approvalContractSource = runtimeSource.slice(approvalContractStart, approvalContractEnd);
    assert(
      approvalContractStart >= 0
        && approvalContractEnd > approvalContractStart
        && approvalContractSource.includes('approvalSchemaVersion: 2')
        && approvalContractSource.includes('normalizedIntentSha256: string')
        && approvalContractSource.includes('pageUrlSha256: string')
        && approvalContractSource.includes('draftTextLength: number')
        && approvalContractSource.includes('targetFingerprint: string')
        && !approvalContractSource.includes('targetId: string')
        && !approvalContractSource.includes('text: string')
        && !approvalContractSource.includes('taskContext')
        && !approvalContractSource.includes('expectedUrl')
        && !approvalContractSource.includes('selector:')
        && !approvalContractSource.includes('name:'),
      'fill runtime: durable v2 approval uses digests and bounded metadata, never raw draft, URL, locator, context, or targetId',
    );

    const validIdentity = {
      browserProcessId: 'uc_browser_process_extractor_fixture',
      browserContextId: 'uc_browser_context_extractor_fixture',
      pageId: 'uc_browser_page_extractor_fixture',
      url: 'https://example.test/draft',
      observedAt: '2026-07-24T12:00:00.000Z',
      evidenceId: 'uc_browser_evidence_extractor_fixture',
    };
    const targetFingerprint = `uc_browser_target_fingerprint_${'b'.repeat(64)}`;
    const targetId = `uc_browser_target_${'c'.repeat(40)}`;
    const extractedTarget = extractBrowserGuardedFillTarget({
      data: {
        ...validIdentity,
        targetId,
        targetFingerprint,
        targetExpiresAt: '2026-07-24T12:02:00.000Z',
        text: 'MUST_NOT_SURVIVE',
        value: 'MUST_NOT_SURVIVE',
      },
    });
    assert(
      extractedTarget?.targetId === targetId
        && extractedTarget.targetFingerprint === targetFingerprint,
      'fill target extractor: bounded target capability and fingerprint survive',
    );
    assert(
      extractedTarget != null
        && !JSON.stringify(extractedTarget).includes('MUST_NOT_SURVIVE'),
      'fill target extractor: arbitrary text/value fields are dropped',
    );
    assert(
      extractBrowserGuardedFillTarget({
        ...validIdentity,
        targetId,
        targetFingerprint,
        targetExpiresAt: validIdentity.observedAt,
      }) === null,
      'fill target extractor: non-future expiry fails closed',
    );

    const proofSecret = 'PROOF_SECRET_MUST_NOT_PERSIST';
    const extractedProof = extractBrowserFillProofMetadata({
      data: {
        ...validIdentity,
        targetFingerprint,
        valueMatches: true,
        valueLength: 12,
        expectedLength: 12,
        mutationPerformed: true,
        targetId,
        text: proofSecret,
        value: proofSecret,
        taskContext: proofSecret,
        locator: proofSecret,
        metadata: { secret: proofSecret },
      },
    });
    assert(extractedProof?.targetFingerprint === targetFingerprint, 'fill proof extractor: approved target fingerprint survives');
    assert(
      extractedProof != null
        && Object.keys(extractedProof).sort().join(',') === [
          'browserContextId',
          'browserProcessId',
          'evidenceId',
          'expectedLength',
          'mutationPerformed',
          'observedAt',
          'pageId',
          'targetFingerprint',
          'url',
          'valueLength',
          'valueMatches',
        ].sort().join(','),
      'fill proof extractor: output is an exact bounded allowlist',
    );
    assert(
      extractedProof != null
        && !JSON.stringify(extractedProof).includes(proofSecret)
        && !('targetId' in extractedProof),
      'fill proof extractor: values, task context, locator, metadata, and targetId are dropped',
    );
    assert(
      extractBrowserFillProofMetadata({
        ...validIdentity,
        valueMatches: true,
        valueLength: 12,
        expectedLength: 12,
        mutationPerformed: true,
      }) === null,
      'fill proof extractor: missing target fingerprint fails closed',
    );
    assert(
      extractBrowserFillProofMetadata({
        ...validIdentity,
        targetFingerprint,
        valueMatches: true,
        valueLength: 11,
        expectedLength: 12,
        mutationPerformed: true,
      }) === null,
      'fill proof extractor: contradictory match flag and lengths fail closed',
    );
  }

  // ─── Guarded checkbox/switch/radio state mutation contract ────────
  {
    const bridgeSource = readFileSync(new URL('./browser-bridge.js', import.meta.url), 'utf8');
    const bridgeRouterSource = readFileSync(new URL('./claude-bridge.js', import.meta.url), 'utf8');
    const clientSource = readFileSync(new URL('../src/lib/browserBridge.ts', import.meta.url), 'utf8');
    const genericInspectionStart = bridgeSource.indexOf(
      'async function inspectResolvedGenericClickTarget(',
    );
    const genericClickHelperStart = bridgeSource.indexOf(
      'async function clickResolvedNonToggleTarget(',
    );
    const genericClickHandlerStart = bridgeSource.indexOf('async function handleClickRole(');
    const observeStart = bridgeSource.indexOf('async function handleObserveGuardedToggleTarget(');
    const mutationStart = bridgeSource.indexOf('async function handleSetToggle(');
    const fillStart = bridgeSource.indexOf('async function handleFill(', mutationStart);
    const genericInspectionSource = bridgeSource.slice(
      genericInspectionStart,
      genericClickHelperStart,
    );
    const genericClickHelperSource = bridgeSource.slice(
      genericClickHelperStart,
      genericClickHandlerStart,
    );
    const genericClickHandlerSource = bridgeSource.slice(
      genericClickHandlerStart,
      observeStart,
    );
    const observeSource = bridgeSource.slice(observeStart, mutationStart);
    const mutationSource = bridgeSource.slice(mutationStart, fillStart);
    assert(
      observeStart >= 0 && mutationStart > observeStart && fillStart > mutationStart,
      'toggle source: separate observation and mutation handlers exist',
    );
    assert(
      genericInspectionStart >= 0
        && genericClickHelperStart > genericInspectionStart
        && genericClickHandlerStart > genericClickHelperStart
        && observeStart > genericClickHandlerStart,
      'generic click source: exact-handle inspector and guarded click helper precede the handler',
    );
    assert(
      genericInspectionSource.includes("tagName === 'input' && (type === 'checkbox' || type === 'radio')")
        && genericInspectionSource.includes("role === 'checkbox' || role === 'switch' || role === 'radio'")
        && genericInspectionSource.includes('label && label.control')
        && genericInspectionSource.includes(
          "element.closest('[role=\"checkbox\"],[role=\"switch\"],[role=\"radio\"]')",
        ),
      'generic click inspection: native/ARIA controls, labels, and descendants are classified from the exact DOM handle despite caller spoofing',
    );
    const exactHandleResolution = genericClickHelperSource.indexOf(
      'targetHandle = await locator.elementHandle({ timeout })',
    );
    const exactHandleInspection = genericClickHelperSource.indexOf(
      'inspectResolvedGenericClickTarget(targetHandle)',
    );
    const toggleRejection = genericClickHelperSource.indexOf(
      "toggleError.browserErrorCode = 'browser_toggle_canary_blocked'",
    );
    const exactHandleClick = genericClickHelperSource.indexOf(
      'await targetHandle.click({ timeout })',
    );
    assert(
      exactHandleResolution >= 0
        && exactHandleResolution < exactHandleInspection
        && exactHandleInspection < toggleRejection
        && toggleRejection < exactHandleClick
        && genericClickHelperSource.includes('await targetHandle.dispose()'),
      'generic click gateway: one exact handle is inspected, state controls are rejected, and only then is that same disposable handle clicked',
    );
    assert(
      genericClickHandlerSource.match(/clickResolvedNonToggleTarget\(/g)?.length === 2
        && !genericClickHandlerSource.includes('await locator.click(')
        && !genericClickHandlerSource.includes('await fb.click(')
        && genericClickHandlerSource.includes(
          'if (firstErr && firstErr.browserErrorCode) throw firstErr;',
        )
        && genericClickHandlerSource.includes(
          'const safeCode = e && e.browserErrorCode ? e.browserErrorCode : undefined;',
        ),
      'generic click gateway: primary and semantic fallback share the guard and typed canary rejection cannot fall through',
    );
    assert(
      bridgeSource.includes('handleObserveGuardedToggleTarget,')
        && bridgeSource.includes('handleSetToggle,')
        && bridgeRouterSource.includes("p === '/browser/toggle_target'")
        && bridgeRouterSource.includes('browserBridge.handleObserveGuardedToggleTarget')
        && bridgeRouterSource.includes("p === '/browser/set_toggle'")
        && bridgeRouterSource.includes('browserBridge.handleSetToggle'),
      'toggle routes: authenticated read-only observation and guarded mutation routes are exported and wired',
    );
    const authGate = bridgeRouterSource.indexOf("const token = req.headers['x-uc-desktop-token']");
    assert(
      authGate >= 0
        && authGate < bridgeRouterSource.indexOf("p === '/browser/toggle_target'")
        && authGate < bridgeRouterSource.indexOf("p === '/browser/set_toggle'"),
      'toggle routes: desktop-token authentication precedes both endpoints',
    );
    assert(
      observeSource.includes("!['checkbox', 'switch', 'radio'].includes(role)")
        && observeSource.includes('Number(Boolean(name)) + Number(Boolean(selector)) !== 1')
        && observeSource.includes('body.exact !== true')
        && observeSource.includes("role === 'radio' && body.desiredState !== true")
        && observeSource.includes('body.submit !== false')
        && observeSource.includes('body.credentialSemantics !== false'),
      'toggle observation: caller contract is exactly one checkbox/switch/radio locator, exact=true, non-submit, non-credential, and radio set-true only',
    );
    assert(
      observeSource.indexOf('hasUnsafeGuardedToggleRequest(body)')
        < observeSource.indexOf('await ensureContext()'),
      'toggle observation: credential/consequential request signals fail before browser setup',
    );
    assert(
      observeSource.includes('matchCount !== 1')
        && observeSource.indexOf('matchCount !== 1') < observeSource.indexOf('locator.elementHandle')
        && observeSource.indexOf('checkExpectedBrowserToggleIdentity(') < observeSource.indexOf('locator.elementHandle')
        && observeSource.indexOf('inspectResolvedToggleTarget(targetHandle)')
          < observeSource.indexOf('guardedTargetCapabilities.issue('),
      'toggle observation: identity and exactly-one resolution gate exact-handle inspection before capability issue',
    );
    assert(
      !observeSource.includes('targetHandle.click(')
        && !observeSource.includes('targetHandle.fill(')
        && !observeSource.includes('targetHandle.press('),
      'toggle observation: target endpoint is read-only',
    );
    assert(
      observeSource.includes("capabilityKind: 'guarded_toggle_v2'")
        && observeSource.includes('invariantFingerprint,')
        && observeSource.includes('initialState: inspection.currentState')
        && observeSource.includes('desiredState: body.desiredState')
        && observeSource.includes('targetHandle = null; // ownership transferred'),
      'toggle observation: one-use capability is kind/state/fingerprint bound and owns the exact ElementHandle',
    );
    const responseStart = observeSource.indexOf(
      'res.end(JSON.stringify({',
      observeSource.indexOf('targetHandle = null; // ownership transferred'),
    );
    const responseSource = observeSource.slice(responseStart, observeSource.indexOf('}));', responseStart) + 4);
    for (const field of [
      'targetId',
      'targetFingerprint',
      'targetExpiresAt',
      'currentState',
      'desiredState',
      'role',
    ]) {
      assert(responseSource.includes(field), `toggle observation response: ${field} is explicit`);
    }
    assert(
      !responseSource.includes('name')
        && !responseSource.includes('selector')
        && !responseSource.includes('taskContext')
        && !responseSource.includes('formText')
        && !responseSource.includes('targetText'),
      'toggle observation response: locator, task context, and raw inspected text are excluded',
    );

    const inspectionStart = bridgeSource.indexOf('async function inspectResolvedToggleTarget(');
    const inspectionEnd = bridgeSource.indexOf(
      '\nconst GUARDED_TOGGLE_STABLE_SEMANTIC_FIELDS',
      inspectionStart,
    );
    const inspectionSource = bridgeSource.slice(inspectionStart, inspectionEnd);
    assert(
      inspectionSource.includes("type === 'checkbox'")
        && inspectionSource.includes("type === 'radio'")
        && inspectionSource.includes("role === 'checkbox' || role === 'switch' || role === 'radio'")
        && !inspectionSource.includes('aria_pressed')
        && !inspectionSource.includes('menuitemcheckbox'),
      'toggle inspection: actual semantics are only native checkbox/radio or explicit ARIA checkbox/switch/radio',
    );
    for (const field of [
      'currentState',
      'ariaChecked',
      'documentUrl',
      'nodeStructure',
      'frameStructure',
      'isConnected',
      'ownerDocumentIsCurrent',
    ]) {
      assert(inspectionSource.includes(field), `toggle inspection: ${field} is captured from the exact handle`);
    }
    const unsafeStart = bridgeSource.indexOf('function isUnsafeGuardedToggleDescriptor(');
    const unsafeEnd = bridgeSource.indexOf('\nasync function inspectResolvedToggleTarget(', unsafeStart);
    const unsafeSource = bridgeSource.slice(unsafeStart, unsafeEnd);
    assert(
      unsafeSource.includes("tagName === 'a'")
        && unsafeSource.includes("role === 'link'")
        && unsafeSource.includes("['submit', 'reset', 'image'].includes(type)")
        && unsafeSource.includes('GUARDED_TOGGLE_CREDENTIAL_RE')
        && unsafeSource.includes('GUARDED_TOGGLE_CONSEQUENTIAL_RE')
        && unsafeSource.includes('guardedToggleSignalsAreSafePreference(semanticSignals)'),
      'toggle semantics: links, submit controls, sensitive settings, and unknown non-preference semantics fail closed',
    );
    assert(
      bridgeSource.includes('const GUARDED_TOGGLE_SAFE_PREFERENCE_RE')
        && bridgeSource.includes('return !guardedToggleSignalsAreSafePreference(signals);')
        && bridgeSource.includes('auto[\\s_-]?renew')
        && bridgeSource.includes('remote[\\s_-]?(?:access|control|desktop|login)')
        && bridgeSource.includes('discoverable')
        && bridgeSource.includes('analytics'),
      'toggle request safety: a positive presentation/accessibility allowlist and explicit consequential canaries guard caller semantics',
    );
    assert(
      bridgeSource.includes("'guarded-toggle-structure-v2\\0'")
        && bridgeSource.includes("'guarded-toggle-invariant-v2\\0'")
        && bridgeSource.includes("'guarded-toggle-fingerprint-v2\\0'")
        && bridgeSource.includes("createHmac('sha256', guardedTargetFingerprintKey)"),
      'toggle fingerprint: current/desired state and semantic/document/node/frame structure use keyed v2 bindings',
    );

    const consumed = mutationSource.indexOf('const consumed = guardedTargetCapabilities.consume(body.targetId)');
    const capabilityCheck = mutationSource.indexOf('checkGuardedToggleCapabilityRecord(');
    const preInspection = mutationSource.indexOf('inspectResolvedToggleTarget(targetHandle)');
    const preFingerprint = mutationSource.indexOf('buildGuardedToggleTargetFingerprint(');
    const previousState = mutationSource.indexOf('const previousState = targetInspection.currentState');
    const mutationDecision = mutationSource.indexOf('const mutationPerformed = previousState !== body.desiredState');
    const exactClick = mutationSource.indexOf('await targetHandle.click({ timeout })');
    const coherentProof = mutationSource.indexOf('await captureCoherentGuardedToggleObservation({');
    const proofBuild = mutationSource.indexOf('buildRedactedBrowserToggleProof(');
    assert(
      mutationSource.includes("body.toggleMode !== 'guarded_non_consequential'")
        && consumed >= 0
        && consumed < capabilityCheck
        && capabilityCheck < preInspection
        && preInspection < preFingerprint
        && preFingerprint < previousState
        && previousState < mutationDecision
        && mutationDecision < exactClick
        && exactClick < coherentProof
        && coherentProof < proofBuild,
      'toggle mutation: consume-first kind binding, exact precheck, verify-before-click, exact-handle click, and coherent proof are ordered',
    );
    assert(
      mutationSource.includes('if (mutationPerformed) {')
        && !mutationSource.includes('resolveLocator(')
        && !mutationSource.includes('.locator(')
        && !mutationSource.includes('pageRef.click('),
      'toggle mutation: already-desired state skips mutation and no locator/general-click path exists',
    );
    assert(
      mutationSource.includes('targetRecord.capabilityKind')
        || bridgeSource.slice(
          bridgeSource.indexOf('function checkGuardedToggleCapabilityRecord('),
          bridgeSource.indexOf('\nasync function captureCoherentGuardedToggleObservation('),
        ).includes("record.capabilityKind !== 'guarded_toggle_v2'"),
      'toggle mutation: cross-kind capabilities fail closed',
    );
    assert(
      mutationSource.includes('proof.stateMatches')
        && mutationSource.includes("errorCode: 'browser_toggle_verification_failed'")
        && mutationSource.includes('finally {')
        && mutationSource.includes('await targetHandle.dispose()'),
      'toggle mutation: desired state is server-verified and consumed handle is disposed on every terminal path',
    );
    const proofStart = bridgeSource.indexOf('function buildRedactedBrowserToggleProof(');
    const proofEnd = bridgeSource.indexOf('\nconst GUARDED_SELECT_MAX_OPTIONS', proofStart);
    const proofSource = bridgeSource.slice(proofStart, proofEnd);
    for (const field of [
      'browserProcessId',
      'browserContextId',
      'pageId',
      'url',
      'observedAt',
      'evidenceId',
      'targetFingerprint',
      'role',
      'previousState',
      'currentState',
      'desiredState',
      'stateMatches',
      'mutationPerformed',
    ]) {
      assert(proofSource.includes(field), `toggle proof source: ${field} is explicit`);
    }
    assert(
      !proofSource.includes('targetId')
        && !proofSource.includes('locator')
        && !proofSource.includes('name')
        && !proofSource.includes('selector')
        && !proofSource.includes('targetText')
        && !proofSource.includes('formText'),
      'toggle proof source: token, locator, name, selector, and raw page text cannot enter proof',
    );
    assert(
      bridgeSource.includes("capabilityKind: 'guarded_fill_v2'")
        && bridgeSource.includes("targetRecord.capabilityKind !== 'guarded_fill_v2'"),
      'capability isolation: guarded fill now rejects toggle capabilities too',
    );

    const selectObserveStart = bridgeSource.indexOf(
      'async function handleObserveGuardedSelectTarget(',
    );
    const selectMutationStart = bridgeSource.indexOf(
      'async function handleGuardedSelectMutation(',
      selectObserveStart,
    );
    const selectDispatchStart = bridgeSource.indexOf(
      'async function handleSelect(',
      selectMutationStart,
    );
    const selectEnd = bridgeSource.indexOf('\nfunction expandUploadPath(', selectDispatchStart);
    const selectObserveSource = bridgeSource.slice(selectObserveStart, selectMutationStart);
    const selectMutationSource = bridgeSource.slice(selectMutationStart, selectDispatchStart);
    const selectDispatchSource = bridgeSource.slice(selectDispatchStart, selectEnd);
    assert(
      selectObserveStart >= 0
        && selectMutationStart > selectObserveStart
        && selectDispatchStart > selectMutationStart
        && selectEnd > selectDispatchStart,
      'select canary source: observe, exact-handle mutation, and sealed dispatcher are present',
    );
    assert(
      bridgeRouterSource.includes("p === '/browser/select'")
        && bridgeRouterSource.includes('browserBridge.handleSelect')
        && bridgeRouterSource.indexOf("const token = req.headers['x-uc-desktop-token']")
          < bridgeRouterSource.indexOf("p === '/browser/select'"),
      'select route: desktop-token authentication precedes the single sealed endpoint',
    );
    assert(
      selectDispatchSource.includes("body.selectMode === 'observe_guarded_native'")
        && selectDispatchSource.includes("body.selectMode === 'guarded_native_single'")
        && selectDispatchSource.includes("'browser_select_canary_blocked'"),
      'select dispatcher: legacy/unsealed calls fail closed and only two sealed phases are admitted',
    );
    assert(
      selectObserveSource.includes('role !== \'combobox\'')
        && selectObserveSource.includes('Number(Boolean(name)) + Number(Boolean(selector)) !== 1')
        && selectObserveSource.includes('!GUARDED_SELECT_MATCH_BY.has(matchBy)')
        && selectObserveSource.includes('body.exact !== true')
        && selectObserveSource.includes('body.submit !== false')
        && selectObserveSource.includes('body.credentialSemantics !== false')
        && selectObserveSource.includes('matchCount !== 1'),
      'select observation: one exact locator, explicit match mode, non-submit semantics, and one target are mandatory',
    );
    assert(
      selectObserveSource.includes('inspectResolvedSelectTarget(targetHandle, { matchBy, value })')
        && selectObserveSource.includes("capabilityKind: 'guarded_select_v1'")
        && selectObserveSource.includes('optionFingerprint,')
        && selectObserveSource.includes('initialOptionFingerprint: currentOptionFingerprint')
        && selectObserveSource.includes('targetHandle = null; // ownership transferred'),
      'select observation: one exact inspected handle and exact option become a one-shot target+option capability',
    );
    const selectInspectionStart = bridgeSource.indexOf(
      'async function inspectResolvedSelectTarget(',
    );
    const selectInspectionEnd = bridgeSource.indexOf(
      '\nconst GUARDED_SELECT_STABLE_TARGET_FIELDS',
      selectInspectionStart,
    );
    const selectInspectionSource = bridgeSource.slice(
      selectInspectionStart,
      selectInspectionEnd,
    );
    for (const invariant of [
      "tagName === 'select'",
      "element.multiple !== true",
      'exactMatches.length === 1',
      'selectedOptions.length === 1',
      'element.getBoundingClientRect',
      'element.matches(\':disabled\')',
      "element.closest('form')",
      "'onchange'",
      "'oninput'",
      'option.disabled === true',
      'group && group.disabled === true',
    ]) {
      assert(
        selectInspectionSource.includes(invariant),
        `select inspection: ${invariant} is captured from the exact native handle`,
      );
    }
    assert(
      bridgeSource.includes("tagName !== 'select'")
        && bridgeSource.includes("String(descriptor.nativeType || '').trim().toLowerCase() !== 'select-one'")
        && bridgeSource.includes('descriptor.hasForm === true')
        && bridgeSource.includes('descriptor.hasInlineMutationHandler === true')
        && bridgeSource.includes('!guardedSelectSignalsAreSafePreference(semanticSignals)'),
      'select inspection: custom/multiple/form/inline-handler/protected/unknown selection targets fail closed',
    );
    assert(
      bridgeSource.includes("'guarded-select-invariant-v1\\0'")
        && bridgeSource.includes("'guarded-select-option-v1\\0'")
        && bridgeSource.includes("'guarded-select-target-v1\\0'")
        && bridgeSource.includes("createHmac('sha256', guardedTargetFingerprintKey)"),
      'select fingerprints: exact target structure, desired option, before state, and match mode use keyed bindings',
    );
    const selectConsumed = selectMutationSource.indexOf(
      'const consumed = guardedTargetCapabilities.consume(body.targetId)',
    );
    const selectCapabilityCheck = selectMutationSource.indexOf(
      'checkGuardedSelectCapabilityRecord(',
    );
    const selectPreInspection = selectMutationSource.indexOf(
      'inspectResolvedSelectTarget(targetHandle, {',
    );
    const selectPreFingerprint = selectMutationSource.indexOf(
      'buildGuardedSelectTargetFingerprint(',
    );
    const selectMutationDecision = selectMutationSource.indexOf(
      'const mutationPerformed = previousOptionFingerprint !== targetRecord.optionFingerprint',
    );
    const exactSelect = selectMutationSource.indexOf(
      'await targetHandle.selectOption(optionSpec, { timeout })',
    );
    const selectCoherentProof = selectMutationSource.indexOf(
      'await captureCoherentGuardedSelectObservation({',
    );
    const selectProofBuild = selectMutationSource.indexOf(
      'buildRedactedBrowserSelectProof(',
    );
    assert(
      selectConsumed >= 0
        && selectConsumed < selectCapabilityCheck
        && selectCapabilityCheck < selectPreInspection
        && selectPreInspection < selectPreFingerprint
        && selectPreFingerprint < selectMutationDecision
        && selectMutationDecision < exactSelect
        && exactSelect < selectCoherentProof
        && selectCoherentProof < selectProofBuild,
      'select mutation: consume, exact reinspection/binding, no-op decision, exact native select, and coherent proof are ordered',
    );
    assert(
      selectMutationSource.includes('if (mutationPerformed) {')
        && !selectMutationSource.includes('resolveLocator(')
        && !selectMutationSource.includes('.click(')
        && !selectMutationSource.includes("getByRole('option'")
        && !selectMutationSource.includes('runWithBrowserDialogHandling('),
      'select mutation: no-op skips dispatch and no locator, click, global option, custom-widget, or dialog-action fallback exists',
    );
    assert(
      selectMutationSource.includes('proof.selectionMatches')
        && selectMutationSource.includes("errorCode: 'browser_select_verification_failed'")
        && selectMutationSource.includes('finally {')
        && selectMutationSource.includes('await targetHandle.dispose()'),
      'select mutation: fresh after proof is mandatory and consumed exact handle is always disposed',
    );
    const selectProofStart = bridgeSource.indexOf(
      'function buildRedactedBrowserSelectProof(',
    );
    const selectProofEnd = bridgeSource.indexOf(
      '\nfunction classifyBrowserFailure(',
      selectProofStart,
    );
    const selectProofSource = bridgeSource.slice(selectProofStart, selectProofEnd);
    for (const field of [
      'browserProcessId',
      'browserContextId',
      'pageId',
      'url',
      'observedAt',
      'evidenceId',
      'targetFingerprint',
      'optionFingerprint',
      'matchBy',
      'previousOptionFingerprint',
      'currentOptionFingerprint',
      'selectionMatches',
      'mutationPerformed',
    ]) {
      assert(selectProofSource.includes(field), `select proof source: ${field} is explicit`);
    }
    assert(
      !selectProofSource.includes('targetId')
        && !selectProofSource.includes('desiredValue')
        && !selectProofSource.includes('locator')
        && !selectProofSource.includes('name')
        && !selectProofSource.includes('selector')
        && !selectProofSource.includes('label'),
      'select proof source: capability, raw option, locator, and page text cannot enter proof',
    );
    assert(
      clientSource.includes('export async function observeGuardedBrowserSelectTarget')
        && clientSource.includes('export async function setGuardedBrowserSelectOption')
        && clientSource.includes('export function extractBrowserGuardedSelectTarget')
        && clientSource.includes('export function extractBrowserSelectProofMetadata')
        && clientSource.includes("selectMode: 'observe_guarded_native'")
        && clientSource.includes("selectMode: 'guarded_native_single'"),
      'select client: observe/mutate contracts and fail-closed parsers use the sealed endpoint modes',
    );
    assert(
      bridgeSource.includes("['combobox', 'listbox', 'option'].includes(role.toLowerCase())")
        && bridgeSource.includes('explicitRole === \'combobox\'')
        && bridgeSource.includes('isSelectionControl: true'),
      'selection bypasses: generic click and guarded fill reject claimed or actual dropdown controls',
    );
  }

  if (failures > 0) {
    console.error(`\n${failures} browser-bridge smoke-test failure(s)`);
    process.exit(1);
  }
  console.log('\nAll browser-bridge smoke cases passed.');
}

main();
