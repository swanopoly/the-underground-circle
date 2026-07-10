/**
 * outcome-verifier-smoketest — verifies the execute→verify reliability pass:
 * a FRESH-CONTEXT verifier grades a mutation-lane task's produced outcome
 * against the evidence contract's proof-after criterion before we report
 * success. Covers the gate, the fresh-context prompt design, the fail-SAFE
 * verdict parse, the verdict->action mapping, and the flag-dark contract hook.
 *
 * Run: npm run smoke:outcome-verifier
 */

import assert from 'node:assert/strict';
import {
  shouldVerifyOutcome,
  buildVerifierPrompt,
  parseVerifierVerdict,
  resolveVerifierAction,
  VERIFIER_MODEL_HINT,
  type OutcomeVerifierEvidenceItem,
} from '../src/lib/outcomeVerifier';
import {
  buildComputerTaskEvidenceContract,
  decideComputerTaskOutcomeVerification,
  type ComputerTaskEvidenceContract,
} from '../src/lib/computerTaskEvidenceContract';
import { buildChatComputerRequestRoute } from '../src/lib/chatComputerRequestRouter';

let passed = 0;
function check(label: string, fn: () => void) {
  fn();
  passed += 1;
}

// ---- Real contracts from the router (canonical task shapes) ---------------
const photoshopRoute = buildChatComputerRequestRoute('Open Photoshop and generate a background then save png');
assert(photoshopRoute?.evidenceContract, 'setup: photoshop route has a contract');
const photoshopContract = photoshopRoute!.evidenceContract;

const browserRoute = buildChatComputerRequestRoute('Log into Shopify and update this product page after I approve');
assert(browserRoute?.evidenceContract, 'setup: browser route has a contract');
const browserContract = browserRoute!.evidenceContract;

const fileReadRoute = buildChatComputerRequestRoute('Search files in Downloads for invoice');
assert(fileReadRoute?.evidenceContract, 'setup: file read route has a contract');
const fileReadContract = fileReadRoute!.evidenceContract;

// A synthetic read-only contract with no approval + no proof (pure read shape).
const pureReadContract: ComputerTaskEvidenceContract = {
  schemaVersion: 1,
  kind: 'local_file',
  targetName: 'Local files',
  taskFamily: 'local file read/search',
  observeBefore: ['resolve exact scoped folder/path before reading'],
  actionabilityChecks: ['file path exists or the missing-path blocker is explicit'],
  approvalBefore: [],
  mutationGuardrails: [],
  proofAfter: [],
  failClosedRules: ['path is outside approved scope'],
  freshEvidenceRequired: [],
  sourceRefs: [],
  userSummary: 'Use scoped file tools, keep safe read/search quiet.',
};

// A synthetic mutation contract that has proofAfter (checkable criterion).
const mutationContract: ComputerTaskEvidenceContract = {
  ...pureReadContract,
  taskFamily: 'local file mutation',
  approvalBefore: ['write, overwrite, move, copy, rename, delete'],
  proofAfter: ['file_stat, hash, basename, or count summary after mutation'],
  userSummary: 'Use scoped file tools and require proof for file mutations.',
};

const sampleEvidence: OutcomeVerifierEvidenceItem[] = [
  { kind: 'artifact', label: 'output.png', ref: 'output.png (1920x1080, sha256:ab12cd)' },
  { kind: 'screenshot', label: 'final canvas', ref: 'screenshot captured after save' },
  { kind: 'inventory', label: 'layer inventory', ref: '3 layers: Background, Subject, Adjust' },
];

// =========================================================================
// 1. shouldVerifyOutcome — the gate
// =========================================================================

check('mutation+proof (photoshop) => verify', () => {
  assert.equal(shouldVerifyOutcome(photoshopContract), true);
});
check('mutation+proof (browser w/ approval) => verify', () => {
  assert.equal(shouldVerifyOutcome(browserContract), true);
});
check('synthetic mutation+proof => verify', () => {
  assert.equal(shouldVerifyOutcome(mutationContract), true);
});
check('read-only file search (no approval, no proof) => NO verify', () => {
  assert.equal(shouldVerifyOutcome(pureReadContract), false);
});
check('router file-read contract => NO verify (read-only lane)', () => {
  // The router's local_file read route: safe read/search, no proof-after that
  // constitutes a mutation criterion beyond a bounded read result.
  const decision = shouldVerifyOutcome(fileReadContract);
  // fileReadContract has a proofAfter ("bounded search/read result"), but its
  // family is read/search with no approval gate -> treated as read-only.
  assert.equal(typeof decision, 'boolean');
  assert.equal(decision, false);
});
check('no checkable proof => NO verify even if approval present', () => {
  const noProof: ComputerTaskEvidenceContract = { ...mutationContract, proofAfter: [] };
  assert.equal(shouldVerifyOutcome(noProof), false);
});
check('proofAfter of only blank strings => NO verify', () => {
  const blankProof: ComputerTaskEvidenceContract = { ...mutationContract, proofAfter: ['', '   '] };
  assert.equal(shouldVerifyOutcome(blankProof), false);
});
check('requireProofAfter:false still needs mutation lane', () => {
  // Even with the proof requirement relaxed, a pure read lane is not verified.
  assert.equal(shouldVerifyOutcome(pureReadContract, { requireProofAfter: false }), false);
});
check('null contract => NO verify (no throw)', () => {
  assert.equal(shouldVerifyOutcome(null), false);
});
check('undefined contract => NO verify (no throw)', () => {
  assert.equal(shouldVerifyOutcome(undefined), false);
});
check('non-object contract => NO verify', () => {
  assert.equal(shouldVerifyOutcome('nope' as unknown as ComputerTaskEvidenceContract), false);
});

// =========================================================================
// 2. buildVerifierPrompt — fresh-context prompt design
// =========================================================================

const photoshopPrompt = buildVerifierPrompt({
  task: 'Open Photoshop and generate a background then save png',
  contract: photoshopContract,
  collectedEvidence: sampleEvidence,
});

check('prompt states the fresh/independent verifier framing', () => {
  assert(/FRESH, INDEPENDENT verifier/i.test(photoshopPrompt), 'names fresh independent verifier');
  assert(/did not run this task/i.test(photoshopPrompt), 'states no prior stake');
});
check('prompt instructs grade outcome NOT tool path', () => {
  assert(/PRODUCED OUTCOME/i.test(photoshopPrompt), 'grades produced outcome');
  assert(/not which tools or path|not the tool path|RESULT, not/i.test(photoshopPrompt), 'grades result not path');
});
check('prompt includes contract proof-after requirements', () => {
  // Photoshop contract requires refreshed inventory / output file_stat.
  assert(/proof-after requirements/i.test(photoshopPrompt), 'labels proof-after requirements');
  assert(
    /layer inventory|file_stat|Photoshop document status/i.test(photoshopPrompt),
    'echoes an actual proof-after item',
  );
});
check('prompt fences untrusted evidence', () => {
  assert(/UNTRUSTED/i.test(photoshopPrompt), 'marks evidence untrusted');
  assert(photoshopPrompt.includes('<<<EVIDENCE'), 'opens evidence fence');
  assert(photoshopPrompt.includes('EVIDENCE>>>'), 'closes evidence fence');
});
check('prompt includes the collected evidence references', () => {
  assert(photoshopPrompt.includes('output.png'), 'includes artifact ref');
  assert(/3 layers/.test(photoshopPrompt), 'includes inventory summary');
});
check('prompt offers PASS/FAIL/UNSURE with one-line reason format', () => {
  assert(/\bPASS\b/.test(photoshopPrompt) && /\bFAIL\b/.test(photoshopPrompt) && /\bUNSURE\b/.test(photoshopPrompt), 'all three verdicts');
  assert(/VERDICT:\s*<PASS\|FAIL\|UNSURE>/i.test(photoshopPrompt), 'strict one-line output format');
  assert(/one short reason/i.test(photoshopPrompt), 'asks for a one-line reason');
});
check('prompt documents UNSURE as the insufficient-evidence escape hatch', () => {
  assert(/insufficient|missing or ambiguous|do NOT guess/i.test(photoshopPrompt), 'UNSURE escape hatch');
});
check('prompt is bounded to <= 2500 chars', () => {
  assert(photoshopPrompt.length <= 2500, `prompt length ${photoshopPrompt.length} <= 2500`);
});
check('prompt never contains raw base64 image bytes', () => {
  const b64Evidence: OutcomeVerifierEvidenceItem[] = [
    { kind: 'screenshot', label: 'proof', ref: `data:image/png;base64,${'A'.repeat(400)}` },
    { kind: 'artifact', label: 'blob', ref: 'B'.repeat(500) },
  ];
  const p = buildVerifierPrompt({ task: 'save file', contract: mutationContract, collectedEvidence: b64Evidence });
  assert(!/[A-Za-z0-9+/]{120,}={0,2}/.test(p), 'no long base64 run survives');
  assert(!/data:image\/png;base64,A{50,}/.test(p), 'no data URL base64 payload survives');
  assert(p.includes('[image ref]') || p.includes('[binary ref]'), 'base64 replaced with a reference token');
  assert(p.length <= 2500, 'still bounded after huge evidence');
});
check('prompt with no evidence says so explicitly (and stays bounded)', () => {
  const p = buildVerifierPrompt({ task: 'save file', contract: mutationContract, collectedEvidence: [] });
  assert(/no evidence was collected/i.test(p), 'states no evidence collected');
  assert(p.length <= 2500, 'bounded');
});
check('prompt clamps very long evidence but keeps the verdict format at the tail', () => {
  const many: OutcomeVerifierEvidenceItem[] = Array.from({ length: 40 }, (_, i) => ({
    kind: 'note',
    label: `item ${i}`,
    ref: `evidence line ${i} `.repeat(30),
  }));
  const p = buildVerifierPrompt({ task: 'x'.repeat(1000), contract: photoshopContract, collectedEvidence: many });
  assert(p.length <= 2500, `clamped length ${p.length} <= 2500`);
  assert(/VERDICT:\s*<PASS\|FAIL\|UNSURE>/i.test(p), 'verdict format survives clamping');
});
check('prompt includes fail-closed rules when the contract has them', () => {
  assert(/Fail-closed rules/i.test(photoshopPrompt), 'includes fail-closed block');
});
check('prompt handles a missing task gracefully', () => {
  const p = buildVerifierPrompt({ task: '', contract: mutationContract });
  assert(/task not provided/i.test(p), 'notes missing task');
});

// =========================================================================
// 3. parseVerifierVerdict — fail-SAFE parse
// =========================================================================

check('parses labeled PASS', () => {
  const r = parseVerifierVerdict('VERDICT: PASS — output.png exists and matches');
  assert.equal(r.verdict, 'pass');
  assert(/output\.png/.test(r.reason), 'captures reason');
});
check('parses labeled FAIL', () => {
  const r = parseVerifierVerdict('VERDICT: FAIL - no output file was produced');
  assert.equal(r.verdict, 'fail');
  assert(/no output file/.test(r.reason));
});
check('parses labeled UNSURE', () => {
  const r = parseVerifierVerdict('VERDICT: UNSURE — evidence does not show the final state');
  assert.equal(r.verdict, 'unsure');
});
check('parses lowercase tokens', () => {
  assert.equal(parseVerifierVerdict('verdict: pass — ok').verdict, 'pass');
  assert.equal(parseVerifierVerdict('i think this is a fail overall').verdict, 'fail');
});
check('parses bare token without label', () => {
  assert.equal(parseVerifierVerdict('PASS').verdict, 'pass');
});
check('empty string => unsure (fail-safe)', () => {
  const r = parseVerifierVerdict('');
  assert.equal(r.verdict, 'unsure');
  assert(/empty/i.test(r.reason));
});
check('null => unsure (fail-safe, no throw)', () => {
  assert.equal(parseVerifierVerdict(null).verdict, 'unsure');
});
check('undefined => unsure (fail-safe, no throw)', () => {
  assert.equal(parseVerifierVerdict(undefined).verdict, 'unsure');
});
check('unparseable gibberish => unsure (never PASS)', () => {
  const r = parseVerifierVerdict('the quick brown fox jumped over the lazy dog');
  assert.equal(r.verdict, 'unsure');
  assert.notEqual(r.verdict, 'pass');
});
check('VERDICT label wins over an incidental earlier token', () => {
  // "passed the file to the tool" mentions pass early, but the label says FAIL.
  const r = parseVerifierVerdict('I passed the file along.\nVERDICT: FAIL — missing receipt');
  assert.equal(r.verdict, 'fail');
});
check('parse always returns a non-empty reason string', () => {
  for (const t of ['PASS', 'FAIL', 'UNSURE', '', 'gibberish', 'VERDICT: PASS']) {
    const r = parseVerifierVerdict(t);
    assert.equal(typeof r.reason, 'string');
    assert(r.reason.length > 0, `reason non-empty for "${t}"`);
  }
});

// =========================================================================
// 4. resolveVerifierAction — verdict -> action mapping
// =========================================================================

check('pass => report_success', () => {
  assert.equal(resolveVerifierAction('pass'), 'report_success');
});
check('unsure => stop_and_report (never falsely claim done)', () => {
  assert.equal(resolveVerifierAction('unsure'), 'stop_and_report');
});
check('fail (first attempt) => retry_with_evidence', () => {
  assert.equal(resolveVerifierAction('fail'), 'retry_with_evidence');
  assert.equal(resolveVerifierAction('fail', { attempt: 0, maxRetries: 1 }), 'retry_with_evidence');
});
check('fail (retries exhausted) => stop_and_report', () => {
  assert.equal(resolveVerifierAction('fail', { attempt: 1, maxRetries: 1 }), 'stop_and_report');
  assert.equal(resolveVerifierAction('fail', { attempt: 2, maxRetries: 1 }), 'stop_and_report');
});
check('fail with maxRetries:0 => stop immediately', () => {
  assert.equal(resolveVerifierAction('fail', { attempt: 0, maxRetries: 0 }), 'stop_and_report');
});
check('fail with a higher retry budget still retries', () => {
  assert.equal(resolveVerifierAction('fail', { attempt: 1, maxRetries: 3 }), 'retry_with_evidence');
});

// =========================================================================
// 5. VERIFIER_MODEL_HINT — fresh-context, cheap-but-capable
// =========================================================================

check('VERIFIER_MODEL_HINT is a non-empty cheap Claude model id', () => {
  assert.equal(typeof VERIFIER_MODEL_HINT, 'string');
  assert(VERIFIER_MODEL_HINT.length > 0);
  assert(/haiku|sonnet/i.test(VERIFIER_MODEL_HINT), 'a cheap-but-capable fresh model');
});

// =========================================================================
// 6. decideComputerTaskOutcomeVerification — the FLAG-DARK contract hook
// =========================================================================

check('flag OFF (default): shouldVerify true but NO model call', () => {
  const d = decideComputerTaskOutcomeVerification({
    task: 'Open Photoshop and generate a background then save png',
    contract: photoshopContract,
    collectedEvidence: sampleEvidence,
  });
  assert.equal(d.shouldVerify, true, 'gate says verify');
  assert.equal(d.modelCallEnabled, false, 'model call disabled by default');
  assert.equal(d.modelCall, null, 'NO live model call by default (flag-dark)');
  assert(typeof d.prompt === 'string' && d.prompt.length > 0, 'prompt still exposed for inspection');
});
check('flag OFF on read-only lane: no verify, no call, no prompt', () => {
  const d = decideComputerTaskOutcomeVerification({
    task: 'Search files in Downloads for invoice',
    contract: pureReadContract,
  });
  assert.equal(d.shouldVerify, false);
  assert.equal(d.modelCall, null);
  assert.equal(d.prompt, null);
});
check('flag ON + verifiable => emits a fresh-context model call', () => {
  const d = decideComputerTaskOutcomeVerification({
    task: 'Open Photoshop and generate a background then save png',
    contract: photoshopContract,
    collectedEvidence: sampleEvidence,
    options: { enableModelCall: true },
  });
  assert.equal(d.modelCallEnabled, true);
  assert(d.modelCall, 'model call present when enabled');
  assert.equal(d.modelCall!.model, VERIFIER_MODEL_HINT, 'uses the fresh-context hint by default');
  assert(d.modelCall!.prompt.length <= 2500, 'call prompt is bounded');
  assert(/PRODUCED OUTCOME/i.test(d.modelCall!.prompt), 'call prompt grades outcome');
});
check('flag ON but read-only lane => still NO model call (gate wins)', () => {
  const d = decideComputerTaskOutcomeVerification({
    task: 'Search files in Downloads for invoice',
    contract: pureReadContract,
    options: { enableModelCall: true },
  });
  assert.equal(d.shouldVerify, false);
  assert.equal(d.modelCallEnabled, false);
  assert.equal(d.modelCall, null);
});
check('flag ON with a custom verifier model override', () => {
  const d = decideComputerTaskOutcomeVerification({
    task: 'save the file',
    contract: mutationContract,
    collectedEvidence: sampleEvidence,
    options: { enableModelCall: true, verifierModel: 'claude-sonnet-4-6' },
  });
  assert.equal(d.modelCall!.model, 'claude-sonnet-4-6');
});
check('resolveAction on the decision honors the attempt policy', () => {
  const d = decideComputerTaskOutcomeVerification({
    task: 'save the file',
    contract: mutationContract,
    collectedEvidence: sampleEvidence,
    options: { attemptPolicy: { attempt: 1, maxRetries: 1 } },
  });
  assert.equal(d.resolveAction('pass'), 'report_success');
  assert.equal(d.resolveAction('unsure'), 'stop_and_report');
  assert.equal(d.resolveAction('fail'), 'stop_and_report', 'retries exhausted per policy');
});

// =========================================================================
// 7. Degenerate inputs never throw
// =========================================================================

check('buildVerifierPrompt tolerates a bare/partial contract', () => {
  const bare = { proofAfter: ['a proof'] } as unknown as ComputerTaskEvidenceContract;
  const p = buildVerifierPrompt({ task: 'do a thing', contract: bare });
  assert(typeof p === 'string' && p.length > 0);
  assert(p.length <= 2500);
});
check('decide tolerates missing evidence + minimal contract', () => {
  const d = decideComputerTaskOutcomeVerification({
    task: 'do a thing',
    contract: mutationContract,
  });
  assert.equal(typeof d.shouldVerify, 'boolean');
  assert.equal(typeof d.resolveAction('pass'), 'string');
});
check('evidence items with null/odd fields do not throw', () => {
  const messy = [
    null as unknown as OutcomeVerifierEvidenceItem,
    { kind: null, label: null, ref: null },
    { ref: 12345 as unknown as string },
    {},
  ];
  const p = buildVerifierPrompt({ task: 'x', contract: mutationContract, collectedEvidence: messy });
  assert(typeof p === 'string' && p.length > 0);
});

console.log(`All outcome verifier smoke cases passed (${passed} checks).`);
