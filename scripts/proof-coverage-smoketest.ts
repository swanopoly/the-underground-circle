/**
 * proof-coverage-smoketest
 *
 * Verifies the loop-level "proof after mutation" check: a turn that mutated an
 * app but captured no proof is flagged missingProof; proof after the last
 * mutation clears it; proof BEFORE the mutation doesn't count; failed mutations
 * don't require proof; read-only/plain turns are never flagged. Pure helpers.
 *
 * Run: npm run smoke:proof-coverage
 */

import assert from 'node:assert/strict';

import { assessProofCoverage, isProofTool, proofCoverageNudge, type ProofCoverageEvent } from '../src/lib/proofCoverage';

const ok = (tool: string): ProofCoverageEvent => ({ tool, status: 'success' });
const fail = (tool: string): ProofCoverageEvent => ({ tool, status: 'error' });

// ── isProofTool ──────────────────────────────────────────────────────────────
assert(isProofTool('desktop.read_a11y_tree'), 'a11y read is proof');
assert(isProofTool('desktop.screenshot'), 'screenshot is proof');
assert(isProofTool('desktop.photoshop_document_status'), 'document status is proof');
assert(isProofTool('desktop.photoshop_export_proof'), 'export_proof is proof');
assert(isProofTool('desktop.indesign_package_document'), 'package is proof');
assert(!isProofTool('desktop.click_element'), 'a mutation is not proof');

// ── assessProofCoverage ──────────────────────────────────────────────────────
// Mutated, no proof → missing.
const noProof = assessProofCoverage([ok('desktop.launch_app'), ok('desktop.set_element_value'), ok('desktop.click_element')]);
assert.equal(noProof.mutated, true, 'detects the mutation');
assert.equal(noProof.missingProof, true, 'no proof after mutation → missingProof');
assert.equal(noProof.lastMutationTool, 'desktop.click_element', 'reports the last mutation');

// Mutated, then proof → covered.
const covered = assessProofCoverage([ok('desktop.click_element'), ok('desktop.read_a11y_tree')]);
assert.equal(covered.missingProof, false, 'proof after the mutation clears it');
assert.equal(covered.proofAfterMutation, true);

// Proof BEFORE the mutation doesn't count (it can't prove a later change).
const proofBefore = assessProofCoverage([ok('desktop.read_a11y_tree'), ok('desktop.click_element')]);
assert.equal(proofBefore.missingProof, true, 'proof before the mutation does not count');

// Export artifact counts as proof (GUI mutation proven by an export).
const exported = assessProofCoverage([ok('desktop.menu_click'), ok('desktop.photoshop_export_proof')]);
assert.equal(exported.mutated, true, 'menu_click is a GUI mutation');
assert.equal(exported.missingProof, false, 'an export after the change counts as proof');

// A FAILED mutation changed nothing → no proof required.
const failedMutation = assessProofCoverage([ok('desktop.read_a11y_tree'), fail('desktop.click_element')]);
assert.equal(failedMutation.mutated, false, 'a failed mutation is not a state change');
assert.equal(failedMutation.missingProof, false, 'no proof required when nothing changed');

// Read-only / plain turn → never flagged.
assert.equal(assessProofCoverage([ok('desktop.read_a11y_tree'), ok('desktop.file_stat')]).missingProof, false, 'read-only turn needs no proof');
assert.equal(assessProofCoverage([]).missingProof, false, 'empty turn needs no proof');
assert.equal(assessProofCoverage(null).mutated, false, 'null is safe');

// Latest mutation is what matters: proof, then a NEW mutation with no proof → missing.
const reMutated = assessProofCoverage([ok('desktop.click_element'), ok('desktop.screenshot'), ok('desktop.type_text')]);
assert.equal(reMutated.missingProof, true, 'a mutation after the last proof re-opens the requirement');

// ── proofCoverageNudge ───────────────────────────────────────────────────────
const nudge = proofCoverageNudge(noProof);
assert(/captured proof|capture proof/i.test(nudge), 'asks for proof');
assert(nudge.includes('desktop.click_element'), 'names the last change');
assert(/screenshot|a11y|file_stat|inventory/i.test(nudge), 'lists concrete proof actions');

console.log('All proof coverage smoke cases passed.');
