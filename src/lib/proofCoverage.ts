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

/** True for tools that constitute proof of a result: a ground-truth observation
 *  or a durable export/package artifact. */
export function isProofTool(name: string | null | undefined): boolean {
  return isObservationTool(name) || EXPORT_PROOF_RE.test(String(name || ''));
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
}

/**
 * Assess whether the turn's tool events captured proof after the last successful
 * app mutation. Only successful mutations count (a failed click changed nothing),
 * and proof must come strictly after that mutation (proof captured before the
 * change doesn't prove the change).
 */
export function assessProofCoverage(
  events: ProofCoverageEvent[] | null | undefined,
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
  let proofAfterMutation = false;
  for (let i = lastMutationIndex + 1; i < list.length; i++) {
    if (isProofTool(list[i]?.tool) && !isFailedStatus(list[i]?.status)) {
      proofAfterMutation = true;
      break;
    }
  }
  return {
    mutated: true,
    proofAfterMutation,
    missingProof: !proofAfterMutation,
    lastMutationTool,
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
