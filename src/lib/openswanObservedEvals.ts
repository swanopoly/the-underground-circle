import type { AgentRun, RunArtifact, RunStatus } from './agentRunSystem';
import { getOpenSwanSkillPlaybook } from './openswanSkillPlaybooks';
import { computeVerificationCoverage } from './verificationCoverageCore';

type VerificationLike = {
  ok?: boolean;
  executed?: boolean;
  status?: string | null;
  summary?: string | null;
};

type ToolLike = {
  status?: string | null;
  title?: string | null;
  output_preview?: string | null;
  summary?: string | null;
};

export type OpenSwanObservedEvalSummary = {
  mode: string | null;
  profile: string | null;
  intent: string | null;
  taskKind: string | null;
  outcome: 'strong' | 'partial' | 'blocked' | 'failed';
  score: number;
  verification: {
    planned: number;
    executed: number;
    passed: number;
    failed: number;
    manualRequired: number;
    blocked: number;
    coverageRatio: number;
  };
  artifacts: {
    total: number;
    durable: number;
    kinds: string[];
  };
  tools: {
    total: number;
    failed: number;
    manualRequired: number;
    blocked: number;
  };
  responseQuality: {
    score: number;
    met: string[];
    missed: string[];
  };
  modeSignals: Array<{
    key: string;
    label: string;
    score: number;
  }>;
  skillSignals: Array<{
    key: string;
    label: string;
    score: number;
    source: string;
  }>;
  blockers: string[];
  strengths: string[];
};

export type OpenSwanObservedEvalAggregate = {
  total: number;
  averageScore: number;
  averageVerificationCoverage: number;
  averageResponseQuality: number;
  blockerRate: number;
  byOutcome: Record<OpenSwanObservedEvalSummary['outcome'], number>;
  byMode: Record<string, number>;
  modeBreakdown: Array<{
    mode: string;
    total: number;
    averageScore: number;
    blockerRate: number;
    averageVerificationCoverage: number;
    averageResponseQuality: number;
    weakestSignal: {
      key: string;
      label: string;
      score: number;
    } | null;
    strong: number;
    blocked: number;
    failed: number;
  }>;
  topBlockers: Array<{
    label: string;
    count: number;
  }>;
};

export type OpenSwanObservedEvalDashboard = {
  aggregate: OpenSwanObservedEvalAggregate;
  recentRuns: Array<{
    score: number;
    outcome: OpenSwanObservedEvalSummary['outcome'];
    mode: string;
    createdAt: string;
  }>;
  weakestModes: Array<{
    mode: string;
    total: number;
    averageScore: number;
    blockerRate: number;
    averageResponseQuality: number;
    weakestSignal: {
      key: string;
      label: string;
      score: number;
    } | null;
    leadingSignals: Array<{
      key: string;
      label: string;
      score: number;
    }>;
  }>;
  failureClusters: Array<{
    key: string;
    label: string;
    mode: string;
    count: number;
    averageScore: number;
  }>;
};

const DURABLE_ARTIFACT_KINDS = new Set([
  'research_brief',
  'design_spec',
  'checklist',
  'report',
  'code_patch',
  'webpage',
  'test_result',
  'browser_proof',
  'diff',
]);

function uniqueNonEmpty(values: Array<string | null | undefined>): string[] {
  return Array.from(new Set(values.map((value) => (value || '').trim()).filter(Boolean)));
}

function clampScore(score: number): number {
  return Math.max(0, Math.min(100, Math.round(score)));
}

function buildModeSignals(args: {
  mode: string | null;
  responseQuality: OpenSwanObservedEvalSummary['responseQuality'];
  verification: OpenSwanObservedEvalSummary['verification'];
  blockers: string[];
  artifacts: {
    total: number;
    durable: number;
    kinds: string[];
  };
}): OpenSwanObservedEvalSummary['modeSignals'] {
  const response = args.responseQuality.score;
  const verificationCoverage = clampScore(args.verification.coverageRatio * 100);
  const artifactDurability = args.artifacts.total > 0
    ? clampScore((args.artifacts.durable / args.artifacts.total) * 100)
    : 0;
  const blockerPenalty = Math.min(60, args.blockers.length * 20);
  const blockerRecovery = clampScore(response - blockerPenalty);

  switch (args.mode) {
    case 'build':
    case 'execute':
      return [
        { key: 'implementation', label: 'Implementation', score: clampScore(Math.round((response + artifactDurability) / 2)) },
        { key: 'verification', label: 'Verification', score: verificationCoverage },
      ];
    case 'review':
      return [
        { key: 'findings', label: 'Findings', score: response },
        { key: 'test_awareness', label: 'Risk & Tests', score: verificationCoverage > 0 ? clampScore(Math.round((response + verificationCoverage) / 2)) : response },
      ];
    case 'research':
      return [
        { key: 'recommendation', label: 'Recommendation', score: response },
        { key: 'evidence', label: 'Evidence', score: clampScore(Math.round((response + artifactDurability + verificationCoverage) / 3)) },
      ];
    case 'support':
      return [
        { key: 'unblock', label: 'Unblock Path', score: response },
        { key: 'recovery', label: 'Recovery Readiness', score: blockerRecovery },
      ];
    case 'plan':
      return [
        { key: 'structure', label: 'Plan Structure', score: response },
        { key: 'risk', label: 'Dependencies & Risks', score: clampScore(Math.round((response + verificationCoverage) / 2)) },
      ];
    case 'design':
      return [
        { key: 'handoff', label: 'Design Handoff', score: response },
        { key: 'preview', label: 'Preview Readiness', score: clampScore(Math.round((response + artifactDurability) / 2)) },
      ];
    default:
      return [
        { key: 'response', label: 'Response', score: response },
      ];
  }
}

function evaluateModeResponseQuality(args: {
  mode: string | null;
  responseText: string;
  artifactKinds: string[];
  verificationPassed: number;
  blockers: string[];
}): OpenSwanObservedEvalSummary['responseQuality'] {
  const mode = args.mode || 'talk';
  const text = args.responseText || '';
  const lower = text.toLowerCase();
  const met: string[] = [];
  const missed: string[] = [];
  let score = 50;

  const hasBullets = /(?:^|\n)-\s+\S/m.test(text) || /(?:^|\n)\d+\.\s+\S/m.test(text);
  const hasCodeOrCommands = /```|(?:^|\n)\$ |\bnpm\b|\bnpx\b|\byarn\b|\bpnpm\b|\bgit\b/m.test(text);
  const hasRecommendation = /\brecommend(?:ation|ed)?\b|\bi recommend\b|\bbest option\b/.test(lower);
  const hasTradeoff = /\btrade-?off\b|\bpros?\b|\bcons?\b|\bcompare\b/.test(lower);
  const hasFindings = /\bfinding[s]?\b|\brisk\b|\bregression\b|\bmissing test\b|\bseverity\b/.test(lower) || hasBullets;
  const hasPhases = /\bphase\b|\bstep 1\b|\bmilestone\b|\bdependency\b|\bsequence\b/.test(lower) || hasBullets;
  const hasUnblockPath = /\bunblock\b|\bnext step\b|\btry this\b|\bprerequisite\b|\bmissing access\b|\bfallback\b/.test(lower) || hasBullets;
  const hasDesignSpecificity = /\blayout\b|\bhierarchy\b|\bspacing\b|\binteraction\b|\bstate\b|\baccessibility\b|\btypography\b/.test(lower);
  const hasBuildSpecificity = args.artifactKinds.length > 0 || args.verificationPassed > 0 || hasCodeOrCommands || /\bimplement(?:ed|ation)?\b|\bchanged\b|\bupdated\b|\bpatch\b/.test(lower);

  if (mode === 'build' || mode === 'execute') {
    if (hasBuildSpecificity) { met.push('concrete implementation detail'); score += 18; } else { missed.push('concrete implementation detail'); score -= 16; }
    if (hasCodeOrCommands) { met.push('actionable commands or code'); score += 12; } else if (mode === 'execute') { missed.push('actionable commands or code'); score -= 10; }
    if (args.verificationPassed > 0 || /\bverify|verification|tested\b/.test(lower)) { met.push('verification or validation'); score += 10; } else { missed.push('verification or validation'); score -= 8; }
  } else if (mode === 'review') {
    if (hasFindings) { met.push('findings-first review structure'); score += 18; } else { missed.push('findings-first review structure'); score -= 16; }
    if (/\btest\b|\bcoverage\b|\brisk\b/.test(lower)) { met.push('risk or test awareness'); score += 10; } else { missed.push('risk or test awareness'); score -= 8; }
  } else if (mode === 'research') {
    if (hasTradeoff) { met.push('tradeoff or comparison analysis'); score += 14; } else { missed.push('tradeoff or comparison analysis'); score -= 10; }
    if (hasRecommendation) { met.push('clear recommendation'); score += 16; } else { missed.push('clear recommendation'); score -= 14; }
    if (args.artifactKinds.includes('research_brief') || /\bevidence\b|\bsource\b|\bcitation\b/.test(lower)) { met.push('evidence-oriented framing'); score += 10; } else { missed.push('evidence-oriented framing'); score -= 8; }
  } else if (mode === 'support') {
    if (hasUnblockPath) { met.push('fast unblock path'); score += 18; } else { missed.push('fast unblock path'); score -= 16; }
    if (args.blockers.length > 0 || /\bblocked\b|\bmissing\b|\brequires\b/.test(lower)) { met.push('clear blocker acknowledgment'); score += 10; } else { missed.push('clear blocker acknowledgment'); score -= 8; }
  } else if (mode === 'plan') {
    if (hasPhases) { met.push('phased plan structure'); score += 18; } else { missed.push('phased plan structure'); score -= 16; }
    if (/\bdependency\b|\brisk\b|\bprerequisite\b/.test(lower)) { met.push('dependencies or risks called out'); score += 10; } else { missed.push('dependencies or risks called out'); score -= 8; }
  } else if (mode === 'design') {
    if (hasDesignSpecificity) { met.push('design-specific handoff detail'); score += 18; } else { missed.push('design-specific handoff detail'); score -= 16; }
    if (/\bpreview\b|\bmockup\b|\bhandoff\b|\bcomponent\b/.test(lower)) { met.push('handoff or preview framing'); score += 10; } else { missed.push('handoff or preview framing'); score -= 8; }
  } else {
    if (text.trim().length > 0 && text.trim().length < 1200) { met.push('appropriately concise answer'); score += 8; }
  }

  return {
    score: clampScore(score),
    met: met.slice(0, 4),
    missed: missed.slice(0, 4),
  };
}

function evaluateActiveSkillSignals(args: {
  activeSkills: Array<{ name?: string; displayName?: string; source?: string }>;
  responseText: string;
  artifactKinds: string[];
  verificationPassed: number;
  toolActions: ToolLike[];
}): OpenSwanObservedEvalSummary['skillSignals'] {
  const text = args.responseText || '';
  const lower = text.toLowerCase();
  const hasBullets = /(?:^|\n)-\s+\S/m.test(text) || /(?:^|\n)\d+\.\s+\S/m.test(text);
  const hasRecommendation = /\brecommend(?:ation|ed)?\b|\bi recommend\b|\bbest option\b/.test(lower);
  const hasTradeoff = /\btrade-?off\b|\bpros?\b|\bcons?\b|\bcompare\b/.test(lower);
  const hasRootCause = /\broot cause\b|\blikely cause\b|\bcaused by\b/.test(lower);
  const hasFindings = /\bfinding[s]?\b|\brisk\b|\bregression\b|\bmissing test\b|\bseverity\b/.test(lower) || hasBullets;
  const hasSummary = /\bsummary\b|\bdecision\b|\bopen question\b|\bnext step\b/.test(lower);
  const hasTests = args.verificationPassed > 0 || /\btest\b|\bassert\b|\bcoverage\b|\bregression\b/.test(lower);
  const hasRefactorShape = /\bextract\b|\bboundary\b|\bseam\b|\bpreserve behavior\b|\bmove\b/.test(lower);
  const hasCodeExplainShape = /\bflow\b|\binvariant\b|\bdata flow\b|\bthis works by\b|\bthe key path\b/.test(lower);
  const usedTools = args.toolActions.length > 0;

  return (args.activeSkills || [])
    .filter((skill) => typeof skill?.name === 'string' && skill.name)
    .slice(0, 6)
    .map((skill) => {
      const playbook = getOpenSwanSkillPlaybook(skill.name!);
      let score = 60;
      switch (skill.name) {
        case 'bug_hunt':
          if (hasRootCause) score += 18; else score -= 12;
          if (hasTests) score += 12; else score -= 8;
          if (usedTools) score += 6;
          break;
        case 'test_writer':
          if (hasTests) score += 20; else score -= 16;
          break;
        case 'critique_pr':
          if (hasFindings) score += 20; else score -= 16;
          if (/\btest\b|\brisk\b/.test(lower)) score += 10;
          break;
        case 'research_topic':
          if (hasTradeoff) score += 14; else score -= 10;
          if (hasRecommendation) score += 16; else score -= 12;
          break;
        case 'summarize_thread':
          if (hasSummary) score += 18; else score -= 14;
          break;
        case 'refactor':
          if (hasRefactorShape) score += 18; else score -= 12;
          if (hasTests) score += 8;
          break;
        case 'code_explain':
          if (hasCodeExplainShape) score += 18; else score -= 12;
          break;
        default:
          if (playbook?.exampleOutcome && text.trim().length > 0) score += 6;
      }
      if (args.artifactKinds.length > 0) score += Math.min(6, args.artifactKinds.length * 2);
      return {
        key: skill.name!,
        label: skill.displayName || skill.name!,
        score: clampScore(score),
        source: skill.source || 'unknown',
      };
    });
}

export function isOpenSwanEvaluableRun(
  run: Pick<AgentRun, 'provider' | 'mode' | 'metadata'> | null | undefined,
): boolean {
  if (!run) return false;
  if (run.provider === 'openswan') return true;
  const metadata = (run.metadata || {}) as Record<string, unknown>;
  return typeof metadata.explicitMode === 'string'
    || typeof metadata.resolvedSessionProfile === 'string'
    || typeof metadata.modeOutcomeSummary === 'object';
}

export function buildOpenSwanObservedEvalSummary(args: {
  run: Pick<AgentRun, 'status' | 'mode' | 'provider' | 'metadata'>;
  artifacts?: Array<Pick<RunArtifact, 'artifact_kind' | 'title'> | { artifact_kind?: string; kind?: string; title?: string }>;
  verificationResults?: VerificationLike[];
  toolActions?: ToolLike[];
  responseText?: string;
}): OpenSwanObservedEvalSummary | null {
  if (!isOpenSwanEvaluableRun(args.run)) return null;

  const metadata = (args.run.metadata || {}) as Record<string, any>;
  const verificationResults = args.verificationResults
    || (Array.isArray(metadata.verification_results) ? metadata.verification_results : []);
  const toolActions = args.toolActions
    || (Array.isArray(metadata.runtimeToolActions) ? metadata.runtimeToolActions : []);
  const artifacts = args.artifacts || [];

  const plannedVerification = Array.isArray(metadata.verificationPlan) ? metadata.verificationPlan.length : 0;
  const executedVerification = verificationResults.filter((result) => result.executed).length;
  // Coverage vs only the AUTO-verifiable checks (audit): a run that ran every
  // machine check (typecheck/tests/lint/…) should score 1.0 — manual-review
  // checks must not drag the ratio down (and 0/0 must be 0, never NaN).
  const autoCoverage = computeVerificationCoverage({
    plannedChecks: metadata.verificationPlan,
    executedCount: executedVerification,
  });
  const passedVerification = verificationResults.filter((result) => result.status === 'passed' || result.ok).length;
  const failedVerification = verificationResults.filter((result) => result.status === 'failed').length;
  const manualVerification = verificationResults.filter((result) => result.status === 'manual_required').length;
  const blockedVerification = verificationResults.filter((result) => result.status === 'blocked').length;

  const totalArtifacts = artifacts.length;
  const durableArtifacts = artifacts.filter((artifact) => {
    const kind = 'artifact_kind' in artifact ? artifact.artifact_kind : artifact.kind;
    return typeof kind === 'string' && DURABLE_ARTIFACT_KINDS.has(kind);
  });
  const artifactKinds = uniqueNonEmpty(artifacts.map((artifact) => ('artifact_kind' in artifact ? artifact.artifact_kind : artifact.kind) || ''));

  const failedTools = toolActions.filter((action) => action.status === 'failed').length;
  const manualTools = toolActions.filter((action) => action.status === 'manual_required').length;
  const blockedTools = toolActions.filter((action) => action.status === 'blocked').length;

  const blockers = uniqueNonEmpty([
    ...(Array.isArray(metadata.modeOutcomeSummary?.blockers) ? metadata.modeOutcomeSummary.blockers : []),
    ...verificationResults
      .filter((result) => result.status === 'failed' || result.status === 'manual_required' || result.status === 'blocked')
      .map((result) => result.summary || ''),
    ...toolActions
      .filter((action) => action.status === 'failed' || action.status === 'manual_required' || action.status === 'blocked')
      .map((action) => action.output_preview || action.summary || action.title || ''),
  ]).slice(0, 6);
  const mode = typeof metadata.explicitMode === 'string' ? metadata.explicitMode : args.run.mode || null;
  const activeSkills = Array.isArray(metadata.activeSkills) ? metadata.activeSkills : [];
  const responseQuality = evaluateModeResponseQuality({
    mode,
    responseText: args.responseText || '',
    artifactKinds,
    verificationPassed: passedVerification,
    blockers,
  });
  const verification = {
    planned: plannedVerification,
    executed: executedVerification,
    passed: passedVerification,
    failed: failedVerification,
    manualRequired: manualVerification,
    blocked: blockedVerification,
    coverageRatio: autoCoverage.coverageRatio,
  };
  const artifactsSummary = {
    total: totalArtifacts,
    durable: durableArtifacts.length,
    kinds: artifactKinds,
  };
  const modeSignals = buildModeSignals({
    mode,
    responseQuality,
    verification,
    blockers,
    artifacts: artifactsSummary,
  });
  const skillSignals = evaluateActiveSkillSignals({
    activeSkills,
    responseText: args.responseText || '',
    artifactKinds,
    verificationPassed: passedVerification,
    toolActions,
  });

  const strengths = uniqueNonEmpty([
    passedVerification > 0 ? `${passedVerification} verification check(s) passed` : null,
    durableArtifacts.length > 0 ? `${durableArtifacts.length} durable artifact(s) produced` : null,
    totalArtifacts > 0 && durableArtifacts.length === 0 ? `${totalArtifacts} artifact(s) produced` : null,
    toolActions.length > 0 && failedTools === 0 && manualTools === 0 && blockedTools === 0 ? `${toolActions.length} tool action(s) completed cleanly` : null,
    typeof metadata.modeOutcomeSummary?.headline === 'string' ? metadata.modeOutcomeSummary.headline : null,
    ...responseQuality.met,
  ]).slice(0, 6);

  let score = 40;
  if (args.run.status === 'completed') score += 15;
  if (args.run.status === 'failed' || args.run.status === 'cancelled') score -= 30;
  score += Math.min(25, passedVerification * 8);
  score -= failedVerification * 10;
  score -= manualVerification * 6;
  score -= blockedVerification * 8;
  score += Math.min(20, durableArtifacts.length * 7);
  score += Math.min(8, Math.max(0, totalArtifacts - durableArtifacts.length) * 2);
  score -= failedTools * 6;
  score -= manualTools * 4;
  score -= blockedTools * 6;
  if (blockers.length > 0) score -= Math.min(18, blockers.length * 4);
  score += Math.round((responseQuality.score - 50) * 0.5);
  score -= responseQuality.missed.length * 2;

  const normalizedScore = clampScore(score);
  let outcome: OpenSwanObservedEvalSummary['outcome'] = 'partial';
  if (args.run.status === 'failed' || normalizedScore < 35) outcome = 'failed';
  else if (blockers.length > 0 || blockedVerification > 0 || manualVerification > 0 || blockedTools > 0 || manualTools > 0) outcome = 'blocked';
  else if (normalizedScore >= 75) outcome = 'strong';

  return {
    mode,
    profile: typeof metadata.resolvedSessionProfile === 'string'
      ? metadata.resolvedSessionProfile
      : typeof metadata.profile === 'string'
        ? metadata.profile
        : null,
    intent: typeof metadata.routingIntent === 'string' ? metadata.routingIntent : null,
    taskKind: typeof metadata.taskKind === 'string' ? metadata.taskKind : null,
    outcome,
    score: normalizedScore,
    verification,
    artifacts: artifactsSummary,
    tools: {
      total: toolActions.length,
      failed: failedTools,
      manualRequired: manualTools,
      blocked: blockedTools,
    },
    responseQuality,
    modeSignals,
    skillSignals,
    blockers,
    strengths,
  };
}

export function buildOpenSwanObservedEvalAggregate(
  summaries: Array<OpenSwanObservedEvalSummary | null | undefined>,
): OpenSwanObservedEvalAggregate {
  const valid = summaries.filter((summary): summary is OpenSwanObservedEvalSummary => Boolean(summary));
  const byOutcome: OpenSwanObservedEvalAggregate['byOutcome'] = {
    strong: 0,
    partial: 0,
    blocked: 0,
    failed: 0,
  };
  const byMode: Record<string, number> = {};
  const modeAccumulator = new Map<string, {
    total: number;
    totalScore: number;
    totalCoverage: number;
    totalResponseQuality: number;
    blockedRuns: number;
    strong: number;
    blocked: number;
    failed: number;
  }>();
  const modeSignalAccumulator = new Map<string, Map<string, { key: string; label: string; total: number; count: number }>>();
  const skillSignalAccumulator = new Map<string, Map<string, { key: string; label: string; total: number; count: number }>>();
  const blockerCounts = new Map<string, number>();
  let totalScore = 0;
  let totalCoverage = 0;
  let totalResponseQuality = 0;
  let blockedRunCount = 0;

  for (const summary of valid) {
    byOutcome[summary.outcome] += 1;
    if (summary.mode) byMode[summary.mode] = (byMode[summary.mode] || 0) + 1;
    totalScore += summary.score;
    totalCoverage += summary.verification.coverageRatio;
    totalResponseQuality += summary.responseQuality.score;
    if (summary.blockers.length > 0 || summary.outcome === 'blocked' || summary.outcome === 'failed') {
      blockedRunCount += 1;
    }

    if (summary.mode) {
      const existing = modeAccumulator.get(summary.mode) || {
        total: 0,
        totalScore: 0,
        totalCoverage: 0,
        totalResponseQuality: 0,
        blockedRuns: 0,
        strong: 0,
        blocked: 0,
        failed: 0,
      };
      existing.total += 1;
      existing.totalScore += summary.score;
      existing.totalCoverage += summary.verification.coverageRatio;
      existing.totalResponseQuality += summary.responseQuality.score;
      if (summary.blockers.length > 0 || summary.outcome === 'blocked' || summary.outcome === 'failed') existing.blockedRuns += 1;
      if (summary.outcome === 'strong') existing.strong += 1;
      if (summary.outcome === 'blocked') existing.blocked += 1;
      if (summary.outcome === 'failed') existing.failed += 1;
      modeAccumulator.set(summary.mode, existing);

      const signalMap = modeSignalAccumulator.get(summary.mode) || new Map<string, { key: string; label: string; total: number; count: number }>();
      for (const signal of summary.modeSignals || []) {
        const existingSignal = signalMap.get(signal.key) || {
          key: signal.key,
          label: signal.label,
          total: 0,
          count: 0,
        };
        existingSignal.total += signal.score;
        existingSignal.count += 1;
        signalMap.set(signal.key, existingSignal);
      }
      modeSignalAccumulator.set(summary.mode, signalMap);

      const skillMap = skillSignalAccumulator.get(summary.mode) || new Map<string, { key: string; label: string; total: number; count: number }>();
      for (const signal of summary.skillSignals || []) {
        const existingSkill = skillMap.get(signal.key) || {
          key: signal.key,
          label: signal.label,
          total: 0,
          count: 0,
        };
        existingSkill.total += signal.score;
        existingSkill.count += 1;
        skillMap.set(signal.key, existingSkill);
      }
      skillSignalAccumulator.set(summary.mode, skillMap);
    }

    for (const blocker of summary.blockers) {
      blockerCounts.set(blocker, (blockerCounts.get(blocker) || 0) + 1);
    }
  }

  return {
    total: valid.length,
    averageScore: valid.length ? Number((totalScore / valid.length).toFixed(1)) : 0,
    averageVerificationCoverage: valid.length ? Number((totalCoverage / valid.length).toFixed(2)) : 0,
    averageResponseQuality: valid.length ? Number((totalResponseQuality / valid.length).toFixed(1)) : 0,
    blockerRate: valid.length ? Number((blockedRunCount / valid.length).toFixed(2)) : 0,
    byOutcome,
    byMode,
    modeBreakdown: Array.from(modeAccumulator.entries())
      .map(([mode, stats]) => {
        const weakestSignal = Array.from(modeSignalAccumulator.get(mode)?.values() || [])
          .map((signal) => ({
            key: signal.key,
            label: signal.label,
            score: clampScore(signal.count > 0 ? signal.total / signal.count : 0),
          }))
          .concat(
            Array.from(skillSignalAccumulator.get(mode)?.values() || []).map((signal) => ({
              key: `skill:${signal.key}`,
              label: signal.label,
              score: clampScore(signal.count > 0 ? signal.total / signal.count : 0),
            })),
          )
          .sort((left, right) => left.score - right.score)[0] || null;
        return {
          mode,
          total: stats.total,
          averageScore: Number((stats.totalScore / stats.total).toFixed(1)),
          blockerRate: Number((stats.blockedRuns / stats.total).toFixed(2)),
          averageVerificationCoverage: Number((stats.totalCoverage / stats.total).toFixed(2)),
          averageResponseQuality: Number((stats.totalResponseQuality / stats.total).toFixed(1)),
          weakestSignal,
          strong: stats.strong,
          blocked: stats.blocked,
          failed: stats.failed,
        };
      })
      .sort((left, right) => right.total - left.total || right.averageScore - left.averageScore)
      .slice(0, 5),
    topBlockers: Array.from(blockerCounts.entries())
      .map(([label, count]) => ({ label, count }))
      .sort((left, right) => right.count - left.count)
      .slice(0, 5),
  };
}

export function buildOpenSwanObservedEvalDashboard(
  runs: Array<{ created_at?: string | null; metadata?: Record<string, unknown> | null } | null | undefined>,
): OpenSwanObservedEvalDashboard {
  const normalized = runs
    .map((run) => {
      const summary = run?.metadata?.observedEval && typeof run.metadata.observedEval === 'object'
        ? run.metadata.observedEval as OpenSwanObservedEvalSummary
        : null;
      if (!summary) return null;
      return {
        createdAt: run?.created_at || '',
        summary,
      };
    })
    .filter((entry): entry is { createdAt: string; summary: OpenSwanObservedEvalSummary } => Boolean(entry));

  const aggregate = buildOpenSwanObservedEvalAggregate(normalized.map((entry) => entry.summary));
  const recentRuns = normalized
    .slice()
    .sort((left, right) => new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime())
    .slice(-10)
    .map((entry) => ({
      score: entry.summary.score,
      outcome: entry.summary.outcome,
      mode: entry.summary.mode || 'unknown',
      createdAt: entry.createdAt,
    }));

  const weakestModes = aggregate.modeBreakdown
    .slice()
    .sort(
      (left, right) =>
        right.blockerRate - left.blockerRate
        || left.averageResponseQuality - right.averageResponseQuality
        || left.averageScore - right.averageScore
        || right.total - left.total,
    )
    .slice(0, 3)
    .map((mode) => ({
      mode: mode.mode,
      total: mode.total,
      averageScore: mode.averageScore,
      blockerRate: mode.blockerRate,
      averageResponseQuality: mode.averageResponseQuality,
      weakestSignal: mode.weakestSignal,
      leadingSignals: Array.from(
        normalized
          .filter((entry) => (entry.summary.mode || 'unknown') === mode.mode)
          .flatMap((entry) => entry.summary.modeSignals || [])
          .reduce((acc, signal) => {
            const existing = acc.get(signal.key) || { key: signal.key, label: signal.label, total: 0, count: 0 };
            existing.total += signal.score;
            existing.count += 1;
            acc.set(signal.key, existing);
            return acc;
          }, new Map<string, { key: string; label: string; total: number; count: number }>())
          .values(),
      ),
    }));

  const normalizedWeakestModes = weakestModes.map((mode) => ({
    ...mode,
    leadingSignals: Array.from(mode.leadingSignals || [])
      .map((signal: any) => ({
        key: signal.key,
        label: signal.label,
        score: clampScore(signal.count > 0 ? signal.total / signal.count : 0),
      }))
      .sort((left, right) => left.score - right.score)
      .slice(0, 2),
  }));

  return {
    aggregate,
    recentRuns,
    weakestModes: normalizedWeakestModes,
    failureClusters: Array.from(
      normalized.reduce((acc, entry) => {
        const mode = entry.summary.mode || 'unknown';
        for (const signal of entry.summary.modeSignals || []) {
          if (signal.score > 69) continue;
          const key = `${mode}::signal::${signal.key}`;
          const existing = acc.get(key) || {
            key,
            label: `Weak ${signal.label}`,
            mode,
            count: 0,
            totalScore: 0,
          };
          existing.count += 1;
          existing.totalScore += signal.score;
          acc.set(key, existing);
        }
        for (const signal of entry.summary.skillSignals || []) {
          if (signal.score > 69) continue;
          const key = `${mode}::skill::${signal.key}`;
          const existing = acc.get(key) || {
            key,
            label: `Weak ${signal.label}`,
            mode,
            count: 0,
            totalScore: 0,
          };
          existing.count += 1;
          existing.totalScore += signal.score;
          acc.set(key, existing);
        }
        for (const missed of entry.summary.responseQuality.missed || []) {
          const key = `${mode}::missed::${missed}`;
          const existing = acc.get(key) || {
            key,
            label: missed,
            mode,
            count: 0,
            totalScore: 0,
          };
          existing.count += 1;
          existing.totalScore += entry.summary.responseQuality.score;
          acc.set(key, existing);
        }
        return acc;
      }, new Map<string, { key: string; label: string; mode: string; count: number; totalScore: number }>() ).values(),
    )
      .map((cluster) => ({
        key: cluster.key,
        label: cluster.label,
        mode: cluster.mode,
        count: cluster.count,
        averageScore: clampScore(cluster.count > 0 ? cluster.totalScore / cluster.count : 0),
      }))
      .sort((left, right) => right.count - left.count || left.averageScore - right.averageScore)
      .slice(0, 6),
  };
}
