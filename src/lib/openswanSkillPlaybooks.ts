export type OpenSwanSkillPlaybook = {
  executionPattern: string[];
  antiPatterns: string[];
  exampleOutcome?: string;
  toolPolicy?: string[];
};

const PLAYBOOKS: Record<string, OpenSwanSkillPlaybook> = {
  bug_hunt: {
    executionPattern: [
      'State the likely root cause before proposing a fix.',
      'Tie the fix to the failing behavior, not only the symptom.',
      'End with a regression check or test path.',
    ],
    antiPatterns: [
      'guessing without naming the evidence',
      'patching symptoms with no root-cause theory',
      'calling the issue fixed without a regression proof path',
    ],
    exampleOutcome: 'Root cause narrowed to stale auth token hydration; patch updates token refresh path and adds a retry regression check.',
    toolPolicy: ['Prefer code.inspect before code.generate.', 'Use verification.tests when the request implies a reproducible failure.'],
  },
  test_writer: {
    executionPattern: [
      'Write or describe the exact behavior under test.',
      'Cover the primary success case and the relevant failure/regression edge.',
      'Keep the test focused on the changed behavior.',
    ],
    antiPatterns: [
      'broad snapshot-heavy coverage with no behavioral proof',
      'tests that simply mirror implementation details',
      'claiming coverage without naming what is asserted',
    ],
    exampleOutcome: 'Adds one regression test for the auth refresh path and one assertion proving the retry state is cleared.',
    toolPolicy: ['Prefer verification.tests when a runnable path exists.', 'If tests cannot run, state the exact test shape that should be added.'],
  },
  critique_pr: {
    executionPattern: [
      'Lead with the highest-severity findings.',
      'Anchor each finding in user-visible risk, regression, or correctness impact.',
      'Separate confirmed issues from open questions.',
    ],
    antiPatterns: [
      'burying findings under summary',
      'style nitpicks before correctness or risk',
      'vague concern with no behavioral consequence',
    ],
    exampleOutcome: 'Flags one high-severity cache invalidation regression, one medium missing-test issue, then closes with a short residual-risk note.',
    toolPolicy: ['Prefer code.review for structured review work.', 'Do not inflate severity when evidence is weak.'],
  },
  research_topic: {
    executionPattern: [
      'Present findings before recommendation.',
      'Compare the strongest options with explicit tradeoffs.',
      'Give one recommended path and state confidence.',
    ],
    antiPatterns: [
      'listing options with no recommendation',
      'mixing facts and inference without labeling them',
      'marketing language instead of evidence',
    ],
    exampleOutcome: 'Compares two queueing approaches, names the operational tradeoffs, and recommends the lower-complexity option with medium confidence.',
    toolPolicy: ['Prefer fetch_url or research.search when evidence matters.', 'Name missing evidence if the recommendation is constrained.'],
  },
  summarize_thread: {
    executionPattern: [
      'Condense to decisions, open questions, and next actions.',
      'Preserve important blockers and ownership changes.',
      'Drop repetition and low-signal chatter.',
    ],
    antiPatterns: [
      'retelling the whole thread chronologically',
      'losing the final decision state',
      'summaries with no next step',
    ],
    exampleOutcome: 'Summarizes a 20-message thread into one decision, two open questions, and one next owner action.',
    toolPolicy: ['Optimize for compression with retained decision value.', 'Keep summaries skimmable.'],
  },
  refactor: {
    executionPattern: [
      'Prefer smaller, reversible structural changes.',
      'State what behavior must stay unchanged.',
      'Call out seams, extraction targets, and follow-up cleanup.',
    ],
    antiPatterns: [
      'large redesigns presented as safe refactors',
      'changing behavior while claiming pure refactor',
      'moving code with no explanation of the new boundary',
    ],
    exampleOutcome: 'Extracts chat input behavior into a controller while preserving submit and slash-command behavior.',
    toolPolicy: ['Use code.inspect to identify seams before code.generate.', 'Pair refactors with verification when behavior is non-trivial.'],
  },
  code_explain: {
    executionPattern: [
      'Explain from outcome to mechanism.',
      'Name the important files, data flow, or invariants.',
      'Keep the explanation proportional to the user request.',
    ],
    antiPatterns: [
      'line-by-line narration of obvious code',
      'architecture claims with no file-level grounding',
      'over-explaining small helpers',
    ],
    exampleOutcome: 'Explains how the run summary layer normalizes metadata once and lets multiple surfaces render the same contract.',
    toolPolicy: ['Prefer file- and behavior-grounded explanation.', 'Use exact file references when possible.'],
  },
};

export function getOpenSwanSkillPlaybook(name: string): OpenSwanSkillPlaybook | null {
  return PLAYBOOKS[name] || null;
}
