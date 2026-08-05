// evals/corpus/skill-gate.ts — golden-case corpus for the LIBRARY-SKILL-GATE
// slice of the deterministic, model-free tier-1 regression net. Pins two things:
//
//   • librarySkillGateCore.renderLibrarySkillsBlock — the SKILL.md library
//     prompt table with the capability-match gate layered on top: a strong
//     dominant content match APPENDS exactly one "Best match for this request"
//     line under the header; a near-tie appends the "Multiple skills match
//     closely … ask the user" line; 'suggest'/'none' append NOTHING so the
//     output stays BYTE-IDENTICAL to the legacy formatLibrarySkillsBlock
//     (legacy substring scoring + ≤2 success boost keep ordering the TABLE
//     only — popularity alone can never clear the gate floor, and gate ids are
//     fence-stripped by the gate core).
//
//   • openswanSkillResolution.resolveOpenSwanSkillsFromCatalog — the
//     persona-side hint-score HOIST (matched-query +5 / task +3 / mode +2
//     precomputed into a map, comparator now map lookups, `hintScore` attached
//     to each resolved skill) changed NOTHING observable: ordered names AND the
//     exact promptBlock equal the pre-refactor capture.
//
// Each case runs the REAL core fn on a FIXED input and returns true iff the
// output equals the value CAPTURED from the real core (never invented).
//
// PURITY: librarySkillGateCore's value imports reach only the two zero-dep
// cores (capabilityMatchGateCore, skillRelevanceCore); openswanSkillResolution's
// only value import is the zero-dep openswanSkillPlaybooks. Both are
// tsx-loadable with no react-native / supabase / deno in the graph, exactly
// like the parent coreGoldenCorpus.

import type { CoreGoldenCase } from '../coreGoldenCorpus';
import {
  renderLibrarySkillsBlock,
  buildLibrarySkillGateLine,
} from '../../src/lib/librarySkillGateCore';
import { resolveOpenSwanSkillsFromCatalog } from '../../src/lib/openswanSkillResolution';
import type { LibrarySkillMetadata } from '../../src/lib/skillLibrary';
import type { Skill } from '../../src/lib/skillRegistry';

// ─── Fixture helpers ───────────────────────────────────────────────────────────

function makeLibrarySkill(
  overrides: Partial<LibrarySkillMetadata> & { name: string },
): LibrarySkillMetadata {
  return {
    id: `skill-${overrides.name}`,
    circleId: 'circle-1',
    authorId: null,
    description: '',
    version: '1.0.0',
    tags: [],
    usageCount: 0,
    successCount: 0,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

/** The two fixed header lines every non-empty library block starts with. */
const LIBRARY_HEADER = [
  '## SKILL.md Library',
  'Circle-authored procedures. Call `viewLibrarySkill(name)` for the full body (procedure / pitfalls / verification) when one looks relevant.',
];

// ─── Persona-hoist fixture (fixed Skill catalog; goldens captured pre-refactor) ─

const PERSONA_ALL_SKILLS: Skill[] = [
  {
    id: 'sk-bug-hunt',
    name: 'bug_hunt',
    displayName: 'Bug Hunt',
    description: 'Root-cause debugging with evidence-first diagnosis.',
    category: 'engineering',
    promptFragment: null,
    requiredTools: [],
    costTier: 'free',
  },
  {
    id: 'sk-test-writer',
    name: 'test_writer',
    displayName: 'Test Writer',
    description: 'Writes focused regression tests for changed behavior.',
    category: 'engineering',
    promptFragment: null,
    requiredTools: [],
    costTier: 'free',
  },
  {
    id: 'sk-summarize',
    name: 'summarize_thread',
    displayName: 'Thread Summarizer',
    description: 'Condenses long threads into decisions and follow-ups.',
    category: 'communication',
    promptFragment: null,
    requiredTools: [],
    costTier: 'free',
  },
];

/** Exact promptBlock captured from resolveOpenSwanSkillsFromCatalog BEFORE the
 *  hint-score hoist (byte-identity is the invariant this golden pins). */
const PERSONA_GOLDEN_BLOCK = [
  '## OpenSwan Active Skills',
  'Treat these as active capability modules. Pull them in when they materially improve the answer or execution path.',
  '- **Test Writer** (test_writer) · recommended',
  '  Why active: This skill is recommended for the active soul and should be available as a strong default.',
  '  Scope: Writes focused regression tests for changed behavior.',
  '  Execution pattern: Write or describe the exact behavior under test. Cover the primary success case and the relevant failure/regression edge. Keep the test focused on the changed behavior.',
  '  Tool policy: Prefer verification.tests when a runnable path exists. If tests cannot run, state the exact test shape that should be added.',
  '  Avoid: broad snapshot-heavy coverage with no behavioral proof; tests that simply mirror implementation details; claiming coverage without naming what is asserted',
  '  Good outcome: Adds one regression test for the auth refresh path and one assertion proving the retry state is cleared.',
  '- **Bug Hunt** (bug_hunt) · inferred',
  '  Why active: The request is debugging-oriented and benefits from root-cause plus regression-check behavior.',
  '  Scope: Root-cause debugging with evidence-first diagnosis.',
  '  Execution pattern: State the likely root cause before proposing a fix. Tie the fix to the failing behavior, not only the symptom. End with a regression check or test path.',
  '  Tool policy: Prefer code.inspect before code.generate. Use verification.tests when the request implies a reproducible failure.',
  '  Avoid: guessing without naming the evidence; patching symptoms with no root-cause theory; calling the issue fixed without a regression proof path',
  '  Good outcome: Root cause narrowed to stale auth token hydration; patch updates token refresh path and adds a retry regression check.',
  '- **Thread Summarizer** (summarize_thread) · enabled',
  '  Why active: This skill is explicitly enabled for the active soul in this circle.',
  '  Scope: Condenses long threads into decisions and follow-ups.',
  '  Execution pattern: Condense to decisions, open questions, and next actions. Preserve important blockers and ownership changes. Drop repetition and low-signal chatter.',
  '  Tool policy: Optimize for compression with retained decision value. Keep summaries skimmable.',
  '  Avoid: retelling the whole thread chronologically; losing the final decision state; summaries with no next step',
  '  Good outcome: Summarizes a 20-message thread into one decision, two open questions, and one next owner action.',
].join('\n');

// ─── The skill-gate corpus ─────────────────────────────────────────────────────

export const CASES: CoreGoldenCase[] = [
  // ══ suite: library-skill-gate (librarySkillGateCore) ══════════════════════════

  {
    id: 'skill-gate-none-appends-nothing-byte-identical',
    suite: 'library-skill-gate',
    describe:
      'zero content overlap anywhere ⇒ gate action none ⇒ the block is BYTE-IDENTICAL to the legacy formatLibrarySkillsBlock golden (nothing appended)',
    run: () => {
      const skills = [
        makeLibrarySkill({ name: 'deploy-checklist', tags: ['deploy'], description: 'steps to deploy the api' }),
        makeLibrarySkill({ name: 'onboarding-guide', description: 'welcome new members' }),
      ];
      const golden = [
        ...LIBRARY_HEADER,
        '- deploy-checklist (v1.0.0) [deploy]: steps to deploy the api',
        '- onboarding-guide (v1.0.0): welcome new members',
      ].join('\n');
      return (
        renderLibrarySkillsBlock(skills, 'what is our vacation policy') === golden &&
        buildLibrarySkillGateLine(skills, 'what is our vacation policy') === null
      );
    },
  },
  {
    id: 'skill-gate-weak-suggest-appends-nothing-byte-identical',
    suite: 'library-skill-gate',
    describe:
      'a lone weak leader (content score 1 < strongScore 6) ⇒ gate action suggest ⇒ nothing appended, block stays byte-identical legacy',
    run: () => {
      const skills = [
        makeLibrarySkill({ name: 'deploy-checklist', tags: ['deploy'], description: 'steps to roll out the api' }),
        makeLibrarySkill({ name: 'onboarding-guide', description: 'welcome new members' }),
      ];
      const golden = [
        ...LIBRARY_HEADER,
        '- deploy-checklist (v1.0.0) [deploy]: steps to roll out the api',
        '- onboarding-guide (v1.0.0): welcome new members',
      ].join('\n');
      return (
        renderLibrarySkillsBlock(skills, 'can someone roll back the change') === golden &&
        buildLibrarySkillGateLine(skills, 'can someone roll back the change') === null
      );
    },
  },
  {
    id: 'skill-gate-strong-match-appends-one-best-match-line',
    suite: 'library-skill-gate',
    describe:
      'a strong dominant content match (score 9, runner-up dropped at the floor) ⇒ exactly ONE "Best match for this request" line right after the header, naming the matching skill',
    run: () => {
      const skills = [
        makeLibrarySkill({
          name: 'mobile-release',
          tags: ['release', 'production'],
          description: 'how to ship the mobile app build to production stores',
        }),
        makeLibrarySkill({ name: 'weather-widget', tags: ['weather'], description: 'render weather forecasts' }),
      ];
      const gateLine =
        'Best match for this request: "mobile-release" — call viewLibrarySkill(\'mobile-release\') and follow it before answering.';
      const golden = [
        ...LIBRARY_HEADER,
        gateLine,
        '- mobile-release (v1.0.0) [release, production]: how to ship the mobile app build to production stores',
        '- weather-widget (v1.0.0) [weather]: render weather forecasts',
      ].join('\n');
      const block = renderLibrarySkillsBlock(skills, 'release the mobile app to production');
      return (
        block === golden &&
        block.split('\n').filter((l) => l.startsWith('Best match for this request:')).length === 1
      );
    },
  },
  {
    id: 'skill-gate-near-tie-appends-ask-line',
    suite: 'library-skill-gate',
    describe:
      'two tag-tied skills (content score 3 each ⇒ near-tie) ⇒ the "Multiple skills match closely … ask the user" line naming both, in the gate core\'s deterministic order',
    run: () => {
      const skills = [
        makeLibrarySkill({ name: 'auth-hardening', tags: ['security'], description: 'lock down endpoints' }),
        makeLibrarySkill({ name: 'dependency-audit', tags: ['security'], description: 'check package versions' }),
      ];
      const askLine =
        'Multiple skills match closely: "auth-hardening", "dependency-audit". Ask the user which one applies before relying on either.';
      const block = renderLibrarySkillsBlock(skills, 'improve the security posture');
      return (
        buildLibrarySkillGateLine(skills, 'improve the security posture') === askLine &&
        block.split('\n')[2] === askLine
      );
    },
  },
  {
    id: 'skill-gate-success-boost-never-clears-floor',
    suite: 'library-skill-gate',
    describe:
      'a usage-100/success-100 skill with ZERO token overlap gets NO gate line (gate scores exclude the boost) while the boost still orders the TABLE (boosted row first, byte-identical legacy)',
    run: () => {
      const skills = [
        makeLibrarySkill({
          name: 'standup-notes',
          tags: ['meetings'],
          description: 'summarize daily standups',
          usageCount: 100,
          successCount: 100,
        }),
        makeLibrarySkill({ name: 'expense-report', tags: ['finance'], description: 'file monthly expenses' }),
      ];
      const golden = [
        ...LIBRARY_HEADER,
        '- standup-notes (v1.0.0) [meetings]: summarize daily standups',
        '- expense-report (v1.0.0) [finance]: file monthly expenses',
      ].join('\n');
      return (
        buildLibrarySkillGateLine(skills, 'what is our vacation policy') === null &&
        renderLibrarySkillsBlock(skills, 'what is our vacation policy') === golden
      );
    },
  },
  {
    id: 'skill-gate-fence-chars-stripped-from-gate-ids',
    suite: 'library-skill-gate',
    describe:
      'fence chars in a skill name are stripped from the GATE line by the gate core (the table row keeps the legacy raw rendering)',
    run: () => {
      const skills = [
        makeLibrarySkill({
          name: 'deploy<step> `runner`',
          tags: ['deploy', 'production'],
          description: 'run the deploy pipeline to production',
        }),
        makeLibrarySkill({ name: 'onboarding-guide', description: 'welcome new members' }),
      ];
      const gateLine = buildLibrarySkillGateLine(skills, 'deploy the service to production');
      return (
        gateLine ===
          'Best match for this request: "deploystep runner" — call viewLibrarySkill(\'deploystep runner\') and follow it before answering.' &&
        renderLibrarySkillsBlock(skills, 'deploy the service to production').includes(
          '- deploy<step> `runner` (v1.0.0)',
        )
      );
    },
  },
  {
    id: 'skill-gate-legacy-vs-gate-divergence-gate-names-own-pick',
    suite: 'library-skill-gate',
    describe:
      'legacy substring scoring + success boost put an off-topic skill at the TOP of the table, but the gate (whole-token, boost-free) names ITS OWN pick in the apply line',
    run: () => {
      const skills = [
        makeLibrarySkill({
          name: 'start-charter',
          tags: ['startup', 'charter', 'artifact'],
          description: 'start the party charter template for the team',
          usageCount: 10,
          successCount: 20,
        }),
        makeLibrarySkill({
          name: 'art-pipeline',
          tags: ['art', 'pipeline'],
          description: 'configure the asset flow',
        }),
      ];
      const block = renderLibrarySkillsBlock(skills, 'set up the art pipeline');
      const lines = block.split('\n');
      return (
        // Gate line names the genuinely-matching skill…
        lines[2] ===
          'Best match for this request: "art-pipeline" — call viewLibrarySkill(\'art-pipeline\') and follow it before answering.' &&
        // …while the legacy-ordered table still lists the off-topic
        // substring-false-positive + boosted skill FIRST.
        lines[3] === '- start-charter (v1.0.0) [startup, charter, artifact]: start the party charter template for the team' &&
        lines[4] === '- art-pipeline (v1.0.0) [art, pipeline]: configure the asset flow'
      );
    },
  },

  // ══ suite: skill-resolution-hoist (openswanSkillResolution) ═══════════════════

  {
    id: 'skill-gate-persona-hoist-order-and-block-unchanged',
    suite: 'skill-resolution-hoist',
    describe:
      'the hint-score hoist changed NOTHING observable: ordered names (hint desc → sourceRank → costTier → displayName) and the exact promptBlock equal the pre-refactor capture, and hintScore now rides along (+5 query / +3 task / +2 mode)',
    run: () => {
      const resolution = resolveOpenSwanSkillsFromCatalog({
        enabledSkills: [PERSONA_ALL_SKILLS[2]],
        allSkills: PERSONA_ALL_SKILLS,
        recommendedSkillNames: ['test_writer'],
        query: 'debug the crash in checkout',
        mode: 'execute',
        taskKind: null,
      });
      const names = resolution.skills.map((s) => s.name);
      const hintScores = resolution.skills.map((s) => s.hintScore);
      return (
        names.length === 3 &&
        names[0] === 'test_writer' &&
        names[1] === 'bug_hunt' &&
        names[2] === 'summarize_thread' &&
        hintScores[0] === 10 &&
        hintScores[1] === 10 &&
        hintScores[2] === 0 &&
        resolution.promptBlock === PERSONA_GOLDEN_BLOCK
      );
    },
  },
];
