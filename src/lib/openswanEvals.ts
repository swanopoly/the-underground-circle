import { analyzeMessageRouting } from './messageRouting';
import {
  getOpenSwanModePolicy,
  resolveOpenSwanProfileForMode,
} from './openswanModePolicy';
import { OPENSWAN_BENCHMARKS, type OpenSwanBenchmarkCase } from './openswanBenchmarks';
import { buildOpenSwanTaskPlan } from './openswanTaskPlanner';

export type OpenSwanBenchmarkFailure = {
  benchmarkId: string;
  title: string;
  reason: string;
};

export type OpenSwanBenchmarkResult = {
  benchmark: OpenSwanBenchmarkCase;
  passed: boolean;
  failures: OpenSwanBenchmarkFailure[];
  actual: {
    modeLabel: string;
    intent: string;
    complexity: string;
    selectedProfile: string;
    resolvedProfile: string;
    taskKind: string;
    verificationKinds: string[];
    tools: string[];
  };
};

export type OpenSwanEvalSummary = {
  total: number;
  passed: number;
  failed: number;
  failures: OpenSwanBenchmarkFailure[];
  results: OpenSwanBenchmarkResult[];
};

function includesAll(actual: string[], required: string[]): string[] {
  return required.filter((item) => !actual.includes(item));
}

export function evaluateOpenSwanBenchmark(
  benchmark: OpenSwanBenchmarkCase,
): OpenSwanBenchmarkResult {
  const routeAnalysis = analyzeMessageRouting(
    benchmark.message,
    benchmark.surface,
    benchmark.recentHistory,
  );
  const modePolicy = getOpenSwanModePolicy(benchmark.mode);
  const profileResolution = resolveOpenSwanProfileForMode(
    benchmark.mode,
    benchmark.message,
    benchmark.surface,
  );
  const taskPlan = buildOpenSwanTaskPlan(
    benchmark.message,
    profileResolution.resolvedProfile,
    routeAnalysis.entities,
  );

  const verificationKinds = taskPlan.verification.map((check) => check.kind);
  const tools = taskPlan.recommendedTools.map((item) => item.tool);
  const failures: OpenSwanBenchmarkFailure[] = [];

  if (routeAnalysis.route.intent !== benchmark.expected.intent) {
    failures.push({
      benchmarkId: benchmark.id,
      title: benchmark.title,
      reason: `expected intent ${benchmark.expected.intent}, got ${routeAnalysis.route.intent}`,
    });
  }
  if (routeAnalysis.route.complexity !== benchmark.expected.complexity) {
    failures.push({
      benchmarkId: benchmark.id,
      title: benchmark.title,
      reason: `expected complexity ${benchmark.expected.complexity}, got ${routeAnalysis.route.complexity}`,
    });
  }
  if (modePolicy.label !== benchmark.expected.modeLabel) {
    failures.push({
      benchmarkId: benchmark.id,
      title: benchmark.title,
      reason: `expected mode label ${benchmark.expected.modeLabel}, got ${modePolicy.label}`,
    });
  }
  if (profileResolution.selectedProfile !== benchmark.expected.selectedProfile) {
    failures.push({
      benchmarkId: benchmark.id,
      title: benchmark.title,
      reason: `expected selected profile ${benchmark.expected.selectedProfile}, got ${profileResolution.selectedProfile}`,
    });
  }
  if (profileResolution.resolvedProfile !== benchmark.expected.resolvedProfile) {
    failures.push({
      benchmarkId: benchmark.id,
      title: benchmark.title,
      reason: `expected resolved profile ${benchmark.expected.resolvedProfile}, got ${profileResolution.resolvedProfile}`,
    });
  }
  if (taskPlan.kind !== benchmark.expected.taskKind) {
    failures.push({
      benchmarkId: benchmark.id,
      title: benchmark.title,
      reason: `expected task kind ${benchmark.expected.taskKind}, got ${taskPlan.kind}`,
    });
  }

  const missingVerification = includesAll(verificationKinds, benchmark.expected.requiredVerification);
  if (missingVerification.length) {
    failures.push({
      benchmarkId: benchmark.id,
      title: benchmark.title,
      reason: `missing verification kinds: ${missingVerification.join(', ')}`,
    });
  }
  const missingTools = includesAll(tools, benchmark.expected.requiredTools);
  if (missingTools.length) {
    failures.push({
      benchmarkId: benchmark.id,
      title: benchmark.title,
      reason: `missing recommended tools: ${missingTools.join(', ')}`,
    });
  }
  if (
    benchmark.expected.preferredCapabilityProfile
    && modePolicy.preferredCapabilityProfile !== benchmark.expected.preferredCapabilityProfile
  ) {
    failures.push({
      benchmarkId: benchmark.id,
      title: benchmark.title,
      reason: `expected preferred capability profile ${benchmark.expected.preferredCapabilityProfile}, got ${modePolicy.preferredCapabilityProfile || 'none'}`,
    });
  }

  return {
    benchmark,
    passed: failures.length === 0,
    failures,
    actual: {
      modeLabel: modePolicy.label,
      intent: routeAnalysis.route.intent,
      complexity: routeAnalysis.route.complexity,
      selectedProfile: profileResolution.selectedProfile,
      resolvedProfile: profileResolution.resolvedProfile,
      taskKind: taskPlan.kind,
      verificationKinds,
      tools,
    },
  };
}

export function runOpenSwanBenchmarks(
  benchmarks: OpenSwanBenchmarkCase[] = OPENSWAN_BENCHMARKS,
): OpenSwanEvalSummary {
  const results = benchmarks.map(evaluateOpenSwanBenchmark);
  const failures = results.flatMap((result) => result.failures);
  return {
    total: results.length,
    passed: results.filter((result) => result.passed).length,
    failed: results.filter((result) => !result.passed).length,
    failures,
    results,
  };
}
