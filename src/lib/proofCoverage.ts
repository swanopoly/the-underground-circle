/**
 * proofCoverage — the loop-level executable enforcement of the evidence
 * contract's "proof after" intent.
 *
 * The computer-task evidence contract (computerTaskEvidenceContract) lists
 * proof-after requirements as guidance strings injected into the prompt. This is
 * the runtime check that the guidance was actually honored: if a turn performed
 * a successful mutating app action but never captured proof of the result
 * (a screenshot / refreshed a11y read / inventory / document status / export),
 * the model shouldn't be allowed to declare "done" without one chance to capture
 * it. Self-gating: a turn with no mutating app action requires no proof, so a
 * plain chat or read-only task is never nudged.
 *
 * Scope: this covers GUI app mutations (click/type/menu/etc. via isAppMutatingTool).
 * Design-app scripted mutators (photoshop_/indesign_ update/place/relink/batch)
 * are intentionally out of scope here — they have their own proof pipeline
 * (designAppExecutionPipeline + designAppObjectManifest), so checking them here
 * would duplicate that. A design read/status/export still COUNTS as proof for a
 * GUI mutation (see isProofTool), it just isn't itself treated as the mutation.
 *
 * Pure + side-effect free → smoke testable. Reuses the shared classifiers so
 * "mutating" and "observation" mean the same thing across the loop.
 */

import { isAppMutatingTool } from './appActionVerificationGate';
import { isObservationTool, isFailedStatus } from './toolLoopProgress';

export interface ProofCoverageEvent {
  tool: string;
  status?: string | null;
}

// Export/packaging tools produce a durable proof artifact (a file), which counts
// as proof-after even though it isn't a read/observation. No \b anchors: these
// are prefixed (photoshop_export_proof) and `_` is a word char, so \b would miss
// them — same reasoning as OBSERVATION_TOOL_RE.
const EXPORT_PROOF_RE = /(export_proof|package_document)/i;

// A DURABLE proof is one that leaves a checkable artifact on disk: an
// export/package tool, or a file_stat of the written output. When the route
// specifically promised a saved/exported file, only a durable proof settles it
// (see targetsDurableArtifact) — a transient screenshot/read doesn't prove the
// file was actually written. `_` is a word char so no \b anchors, matching the
// prefixed tool names (desktop.file_stat, photoshop_export_proof).
const DURABLE_PROOF_RE = /(export_proof|package_document|file_stat)/i;

/** True for tools that constitute proof of a result: a ground-truth observation
 *  or a durable export/package artifact. */
export function isProofTool(name: string | null | undefined): boolean {
  return isObservationTool(name) || EXPORT_PROOF_RE.test(String(name || ''));
}

/** True for tools that leave a checkable on-disk artifact (export/package or a
 *  file_stat of the output). A strict subset of isProofTool. */
export function isDurableProofTool(name: string | null | undefined): boolean {
  return DURABLE_PROOF_RE.test(String(name || ''));
}

/**
 * Whether the route's proof requirement (its completionProof / proofAfter
 * strings) specifically promised a saved/exported FILE artifact — e.g. "output
 * file_stat …", "exported proof artifact", "package summary". Only then do we
 * raise the bar to a durable proof; a generic "refreshed state / confirmation"
 * requirement stays satisfied by any proof (today's behavior — no over-block).
 *
 * Deliberately conservative: matches only unambiguous file/export/package
 * language so a plain visual/read requirement is never mis-escalated.
 */
export function targetsDurableArtifact(
  proofRequirements: Array<string | null | undefined> | null | undefined,
): boolean {
  if (!Array.isArray(proofRequirements) || proofRequirements.length === 0) return false;
  const text = proofRequirements.map((item) => String(item || '')).join(' | ').toLowerCase();
  if (!text) return false;
  // Require an explicit file/export/package noun. "screenshot"/"confirmation"
  // alone must NOT trigger this — they are transient proofs by design.
  return /\b(file_stat|exported|export proof|export artifact|package (?:document|summary)|saved file|written file|output file|basename\/hash|file on disk)\b/i.test(text);
}

export interface ProofCoverageAssessment {
  /** Did the turn perform a successful mutating app action? */
  mutated: boolean;
  /** Was there a successful proof tool AFTER the last successful mutation? */
  proofAfterMutation: boolean;
  /** Mutated but no proof captured after → "done" is not yet trustworthy. */
  missingProof: boolean;
  /** The last mutating tool, for the nudge wording. */
  lastMutationTool?: string;
  /**
   * Set when the route specifically promised a saved/exported file and the only
   * proof captured was transient (a read/screenshot, not a durable export /
   * package / file_stat). The turn "has proof" in the generic sense but not the
   * artifact the route contracted for, so the nudge asks for the file proof.
   * Never set when no proof-requirement context is supplied.
   */
  needsDurableProof?: boolean;
}

export interface ProofCoverageOptions {
  /**
   * The route's proof-after / completionProof requirement strings (from the
   * evidence contract). When these promise a file/export artifact
   * (targetsDurableArtifact), a transient read/screenshot no longer settles the
   * turn — only a durable export/package/file_stat does. Omit for today's
   * any-proof behavior (used by callers without route context).
   */
  proofRequirements?: Array<string | null | undefined> | null;
}

/**
 * Assess whether the turn's tool events captured proof after the last successful
 * app mutation. Only successful mutations count (a failed click changed nothing),
 * and proof must come strictly after that mutation (proof captured before the
 * change doesn't prove the change).
 */
export function assessProofCoverage(
  events: ProofCoverageEvent[] | null | undefined,
  opts?: ProofCoverageOptions | null,
): ProofCoverageAssessment {
  const list = Array.isArray(events) ? events : [];
  let lastMutationIndex = -1;
  let lastMutationTool: string | undefined;
  for (let i = 0; i < list.length; i++) {
    const tool = String(list[i]?.tool || '');
    if (isAppMutatingTool(tool) && !isFailedStatus(list[i]?.status)) {
      lastMutationIndex = i;
      lastMutationTool = tool;
    }
  }
  if (lastMutationIndex === -1) {
    return { mutated: false, proofAfterMutation: false, missingProof: false };
  }
  // Only when the route explicitly promised a saved/exported file do we require
  // a DURABLE proof; otherwise any proof settles the turn (today's behavior).
  const requireDurable = targetsDurableArtifact(opts?.proofRequirements);
  let proofAfterMutation = false;
  let durableProofAfterMutation = false;
  for (let i = lastMutationIndex + 1; i < list.length; i++) {
    const event = list[i];
    if (isFailedStatus(event?.status)) continue;
    if (isProofTool(event?.tool)) proofAfterMutation = true;
    if (isDurableProofTool(event?.tool)) durableProofAfterMutation = true;
    // Fast exit once we have everything the route needs.
    if (proofAfterMutation && (!requireDurable || durableProofAfterMutation)) break;
  }
  // Missing proof when there's no proof at all, OR the route contracted a file
  // artifact but only a transient proof (read/screenshot) was captured.
  const missingProof = !proofAfterMutation || (requireDurable && !durableProofAfterMutation);
  const needsDurableProof = requireDurable && proofAfterMutation && !durableProofAfterMutation;
  return {
    mutated: true,
    proofAfterMutation,
    missingProof,
    lastMutationTool,
    needsDurableProof,
  };
}

/**
 * The nudge fed back when the model tries to finish a turn that mutated an app
 * without capturing proof. Names concrete proof actions and is explicit that one
 * proof step is the last thing needed.
 */
export function proofCoverageNudge(assessment: ProofCoverageAssessment): string {
  const tool = assessment.lastMutationTool || '';
  const tail = tool ? ` (last change: \`${tool}\`)` : '';
  // The route promised a saved/exported FILE but only a transient read/screenshot
  // was captured — ask specifically for the durable artifact, not another read.
  if (assessment.needsDurableProof) {
    return [
      '',
      `⚠️ Before finishing: you changed app state${tail} and captured a read/screenshot, but this task promised a saved/exported file — that file proof is still missing.`,
      'Capture the durable artifact now, then give your final answer:',
      '- export/save the artifact and confirm the file exists (file_stat: basename, size/hash), or',
      '- for a packaged output, produce the package and confirm its summary.',
      'This is the last step — one durable proof action, then summarize what you did and the file proof of it.',
    ].join('\n');
  }
  // Surface-aware proof options: a browser mutation is proven by re-reading the
  // DOM / verification state / screenshot, not by desktop reads or design exports.
  const proofOptions = tool.startsWith('browser.')
    ? [
        '- re-read the page (`browser.dom_snapshot`) and confirm the change is present, or',
        '- check the success/verification state (`browser.verification_state`), or',
        '- take a screenshot of the result (`browser.screenshot`).',
      ]
    : [
        '- re-read the relevant state (a11y tree / refreshed inventory / document status), or',
        '- take a screenshot of the result, or',
        '- export/save the artifact and confirm the file exists (file_stat).',
      ];
  return [
    '',
    `⚠️ Before finishing: you changed app state${tail} but haven't captured proof the change took effect.`,
    'Capture proof now, then give your final answer:',
    ...proofOptions,
    'This is the last step — one proof action, then summarize what you did and the proof of it.',
  ].join('\n');
}
