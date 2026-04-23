import type { BrowserPlanCardData } from './computerUse';
import type { BrowserPlanEvent, BrowserSessionRecord } from './computerUse';
import type { OpenSwanExecutionContract } from './openswanExecution';
import type { OpenSwanObservedEvalSummary } from './openswanObservedEvals';
import { readRunCommandDecisions } from './runRouting';

export type RunMetadataSummaryProps = {
  commandDecisions: ReturnType<typeof readRunCommandDecisions>;
  browserPlans: BrowserPlanCardData[];
  delegatedSubagents: string[];
  activeSkills: Array<{
    name: string;
    displayName: string;
    source: string;
  }>;
  modeContext: {
    key: string | null;
    label: string | null;
    description: string | null;
    outcome: string | null;
  } | null;
  modePresentation: {
    focusAreas: string[];
    browserTitle: string;
    executionTitle: string;
    verificationTitle: string;
  } | null;
  modeOutcomeSummary: {
    headline: string;
    bulletPoints: string[];
    blockers: string[];
  } | null;
  observedEval: OpenSwanObservedEvalSummary | null;
};

function buildModePresentation(modeKey: string | null | undefined): RunMetadataSummaryProps['modePresentation'] {
  switch (modeKey) {
    case 'research':
      return {
        focusAreas: ['evidence', 'tradeoffs', 'recommendation'],
        browserTitle: 'RESEARCH BROWSER',
        executionTitle: 'EVIDENCE TRAIL',
        verificationTitle: 'EVIDENCE & CHECKS',
      };
    case 'design':
      return {
        focusAreas: ['layout', 'interaction', 'preview'],
        browserTitle: 'PREVIEWS & BROWSER',
        executionTitle: 'DESIGN EXECUTION',
        verificationTitle: 'DESIGN CHECKS',
      };
    case 'support':
      return {
        focusAreas: ['blockers', 'recovery', 'next step'],
        browserTitle: 'SUPPORT BROWSER',
        executionTitle: 'BLOCKERS & RECOVERY',
        verificationTitle: 'RECOVERY CHECKS',
      };
    case 'build':
      return {
        focusAreas: ['implementation', 'delivery', 'verification'],
        browserTitle: 'BUILD BROWSER',
        executionTitle: 'BUILD EXECUTION',
        verificationTitle: 'SHIP CHECKS',
      };
    default:
      return null;
  }
}

export function buildRunMetadataSummaryProps(
  metadata: Record<string, any> | null | undefined,
): RunMetadataSummaryProps {
  const explicitMode = typeof metadata?.explicitMode === 'string' ? metadata.explicitMode : null;
  const modeLabel = typeof metadata?.modeLabel === 'string' ? metadata.modeLabel : null;
  const modeDescription = typeof metadata?.modeDescription === 'string' ? metadata.modeDescription : null;
  const modeOutcome = typeof metadata?.modeOutcome === 'string' ? metadata.modeOutcome : null;
  const modeOutcomeSummary = metadata?.modeOutcomeSummary && typeof metadata.modeOutcomeSummary === 'object'
    ? {
        headline: typeof metadata.modeOutcomeSummary.headline === 'string' ? metadata.modeOutcomeSummary.headline : '',
        bulletPoints: Array.isArray(metadata.modeOutcomeSummary.bulletPoints) ? metadata.modeOutcomeSummary.bulletPoints.filter((value: unknown): value is string => typeof value === 'string') : [],
        blockers: Array.isArray(metadata.modeOutcomeSummary.blockers) ? metadata.modeOutcomeSummary.blockers.filter((value: unknown): value is string => typeof value === 'string') : [],
      }
    : null;
  return {
    commandDecisions: readRunCommandDecisions(metadata),
    browserPlans: Array.isArray(metadata?.browserPlans) ? metadata.browserPlans as BrowserPlanCardData[] : [],
    delegatedSubagents: Array.isArray(metadata?.delegated_subagents) ? metadata.delegated_subagents : [],
    activeSkills: Array.isArray(metadata?.activeSkills)
      ? metadata.activeSkills
          .filter((value: unknown) => Boolean(value) && typeof value === 'object')
          .map((skill: any) => ({
            name: typeof skill.name === 'string' ? skill.name : '',
            displayName: typeof skill.displayName === 'string' ? skill.displayName : (typeof skill.name === 'string' ? skill.name : 'Skill'),
            source: typeof skill.source === 'string' ? skill.source : 'unknown',
          }))
          .filter((skill) => skill.name)
      : [],
    modeContext: explicitMode || modeLabel || modeDescription || modeOutcome ? {
      key: explicitMode,
      label: modeLabel,
      description: modeDescription,
      outcome: modeOutcome,
    } : null,
    modePresentation: buildModePresentation(explicitMode),
    modeOutcomeSummary,
    observedEval: readRunObservedEval(metadata),
  };
}

export function readRunExecutionStream(
  metadata: Record<string, any> | null | undefined,
): OpenSwanExecutionContract[] {
  return Array.isArray(metadata?.execution_stream) ? metadata.execution_stream as OpenSwanExecutionContract[] : [];
}

export function readRunBrowserPlanEvents(
  metadata: Record<string, any> | null | undefined,
): BrowserPlanEvent[] {
  return Array.isArray(metadata?.browserPlanEvents) ? metadata.browserPlanEvents as BrowserPlanEvent[] : [];
}

export function readRunBrowserSessions(
  metadata: Record<string, any> | null | undefined,
): BrowserSessionRecord[] {
  return Array.isArray(metadata?.browserSessions) ? metadata.browserSessions as BrowserSessionRecord[] : [];
}

export function readRunObservedEval(
  metadata: Record<string, any> | null | undefined,
): OpenSwanObservedEvalSummary | null {
  if (!(metadata?.observedEval && typeof metadata.observedEval === 'object')) return null;
  const observedEval = metadata.observedEval as OpenSwanObservedEvalSummary;
  return {
    ...observedEval,
    responseQuality: observedEval.responseQuality && typeof observedEval.responseQuality === 'object'
      ? {
          score: typeof observedEval.responseQuality.score === 'number' ? observedEval.responseQuality.score : 0,
          met: Array.isArray(observedEval.responseQuality.met) ? observedEval.responseQuality.met.filter((value): value is string => typeof value === 'string') : [],
          missed: Array.isArray(observedEval.responseQuality.missed) ? observedEval.responseQuality.missed.filter((value): value is string => typeof value === 'string') : [],
        }
      : {
          score: 0,
          met: [],
          missed: [],
        },
    modeSignals: Array.isArray(observedEval.modeSignals)
      ? observedEval.modeSignals
          .filter((value) => Boolean(value) && typeof value === 'object')
          .map((signal) => ({
            key: typeof (signal as { key?: unknown }).key === 'string' ? (signal as { key: string }).key : 'response',
            label: typeof (signal as { label?: unknown }).label === 'string' ? (signal as { label: string }).label : 'Response',
            score: typeof (signal as { score?: unknown }).score === 'number' ? (signal as { score: number }).score : 0,
          }))
      : [],
    skillSignals: Array.isArray((observedEval as any).skillSignals)
      ? (observedEval as any).skillSignals
          .filter((value: unknown) => Boolean(value) && typeof value === 'object')
          .map((signal: any) => ({
            key: typeof signal.key === 'string' ? signal.key : 'skill',
            label: typeof signal.label === 'string' ? signal.label : 'Skill',
            score: typeof signal.score === 'number' ? signal.score : 0,
            source: typeof signal.source === 'string' ? signal.source : 'unknown',
          }))
      : [],
  };
}
