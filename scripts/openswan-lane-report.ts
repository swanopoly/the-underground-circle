import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

import {
  buildAgentWorktreeQualityChecklist,
  type AgentWorktreePathFinding,
} from '../src/lib/agentDevelopmentStandards';

export type OpenSwanLaneId =
  | 'lane0_traffic_control'
  | 'lane1_swanbot_v2_readiness'
  | 'lane2_chat_dispatcher'
  | 'lane3_openswan_typed_core'
  | 'lane4_tool_catalog_contracts'
  | 'lane5_computer_app_evidence'
  | 'lane6_wordpress_managed_sites'
  | 'lane7_provider_cost_routing'
  | 'lane8_product_ui_console'
  | 'lane9_knowledge_research'
  | 'lane10_edge_sql'
  | 'lane99_unmapped_review';

export type OpenSwanLaneReportStatus = 'clean' | 'narrow' | 'broad';

export interface OpenSwanLaneDefinition {
  id: OpenSwanLaneId;
  label: string;
  purpose: string;
  ownerRuleIds: string[];
  matchers: RegExp[];
  canonicalDocs: string[];
  dailyVerification: string[];
  releaseVerification: string[];
}

export interface OpenSwanLanePath {
  path: string;
  rawPath: string;
  ownerRuleId: string;
  ownerLabel: string;
  isUntracked: boolean;
}

export interface OpenSwanLaneBucket {
  lane: OpenSwanLaneDefinition;
  paths: OpenSwanLanePath[];
  ownerRuleIds: string[];
  verificationCommands: string[];
  canonicalDocs: string[];
}

export interface BuildOpenSwanLaneReportOptions {
  taskDescription?: string | null;
  statusLines?: string[] | null;
  repoRoot?: string;
  maxActiveLanes?: number;
  maxChangedPaths?: number;
}

export interface OpenSwanLaneReport {
  taskDescription: string;
  status: OpenSwanLaneReportStatus;
  activeLaneCount: number;
  changedPathCount: number;
  untrackedPathCount: number;
  maxActiveLanes: number;
  maxChangedPaths: number;
  summary: string;
  nextActions: string[];
  buckets: OpenSwanLaneBucket[];
  unmappedPaths: OpenSwanLanePath[];
  verificationCommands: string[];
  riskIds: string[];
}

interface CliOptions {
  repoRoot: string;
  taskDescription: string;
  format: 'summary' | 'json';
  failOnBroad: boolean;
  maxActiveLanes: number;
  maxChangedPaths: number;
}

const DEFAULT_MAX_ACTIVE_LANES = 2;
const DEFAULT_MAX_CHANGED_PATHS = 40;

export const OPENSWAN_AGENT_LANES: OpenSwanLaneDefinition[] = [
  {
    id: 'lane0_traffic_control',
    label: 'Lane 0 - Traffic Control',
    purpose: 'Read-order docs, ownership tables, package scripts, and worktree quality tooling.',
    ownerRuleIds: ['agent_standards', 'package_scripts_and_repo_metadata', 'canonical_docs'],
    matchers: [
      /^AGENTS?\.md$/,
      /^CLAUDE\.md$/,
      /^Gemini\.md$/,
      /^MEMORY\.md$/,
      /^docs\/AGENTS_ROADMAP\.md$/,
      /^docs\/UC_APP_STACK_REFERENCE\.md$/,
      /^docs\/AGENT_DEVELOPMENT_STANDARDS_INDEX\.md$/,
      /^docs\/SWANBOT_OPENSWAN_AGENT_LANES_/,
      /^package(?:-lock)?\.json$/,
      /^scripts\/openswan-(?:lane|worktree)/,
      /^src\/lib\/(?:agentDevelopmentStandards|openswanWorktreeConfig)\.ts$/,
    ],
    canonicalDocs: [
      'AGENTS.md',
      'docs/AGENTS_ROADMAP.md',
      'docs/UC_APP_STACK_REFERENCE.md',
    ],
    dailyVerification: [
      'npm run smoke:openswan-lane-report',
      'npm run check:openswan-lanes',
      'git diff --check',
    ],
    releaseVerification: [
      'npm run check:openswan-worktree-config',
      'npm run check:openswan-lanes',
      'npm run typecheck:app',
    ],
  },
  {
    id: 'lane1_swanbot_v2_readiness',
    label: 'Lane 1 - SwanBot v2 Readiness',
    purpose: 'SwanBot client, v2 parity, continuation, dedupe, readiness, and edge SwanBot loops.',
    ownerRuleIds: [],
    matchers: [
      /^src\/lib\/swanbot/,
      /^supabase\/functions\/(?:swanbot|_shared\/swanbot)/,
      /^scripts\/swanbot-/,
      /^docs\/SWANBOT_V2_MIGRATION_PLAN\.md$/,
    ],
    canonicalDocs: ['docs/AGENTS_ROADMAP.md', 'docs/SWANBOT_V2_MIGRATION_PLAN.md'],
    dailyVerification: [
      'npm run smoke:swanbot-openswan-readiness',
      'npm run smoke:swanbot-v2-stop-reason',
      'npm run smoke:swanbot-v2-dispatcher-parity',
      'npm run smoke:swanbot-v2-continuation',
      'npm run typecheck:app',
    ],
    releaseVerification: [
      'npm run smoke:swanbot-routing',
      'npm run smoke:swanbot-turn-dedupe',
      'npm run smoke:swanbot-openswan-readiness',
      'npm run smoke:swanbot-v2-dispatcher-parity',
      'npm run smoke:swanbot-v2-stop-reason',
      'npm run smoke:swanbot-v2-continuation',
      'npm run smoke:swanbot-v2-delegation',
      'npm run smoke:swanbot-v2-writers',
      'npm run smoke:swanbot-v2-workspace',
      'npm run smoke:swanbot-v2-approvals',
      'npm run smoke:swanbot-v2-retry',
      'npm run smoke:swanbot-v2-wp',
      'npm run smoke:swanbot-v2-wp-approval-gate',
      'npm run typecheck:app',
      'npm run typecheck:functions',
    ],
  },
  {
    id: 'lane2_chat_dispatcher',
    label: 'Lane 2 - Chat Dispatcher',
    purpose: 'Chat planner, command routing, transport handlers, transcript metadata, and chat UX cards.',
    ownerRuleIds: ['chat_task_planning_metadata'],
    matchers: [
      /^src\/lib\/chat/,
      /^src\/lib\/runChatAutomationPlan/,
      /^src\/lib\/conversationalRouter\.ts$/,
      /^src\/screens\/circles\/tabs\/ChatTab\.tsx$/,
      /^src\/screens\/circles\/tabs\/chat\//,
      /^scripts\/chat-/,
      /^scripts\/simple-chat-/,
      /^scripts\/automation-cadence-format-/,
    ],
    canonicalDocs: ['docs/AGENTS_ROADMAP.md', 'docs/CHAT_AUTOMATION_AUDIT_PLAN_2026-04-21.md'],
    dailyVerification: ['npm run smoke:chat-planner'],
    releaseVerification: [
      'npm run smoke:chat-planner',
      'npm run smoke:chat-transport-handlers',
      'npm run smoke:chat-terminal-transport-policy',
      'npm run smoke:chat-automation-executor-coverage',
    ],
  },
  {
    id: 'lane3_openswan_typed_core',
    label: 'Lane 3 - OpenSwan Typed Core',
    purpose: 'Agent execution core, OpenSwan session runtime, delegation, skills, and circle context.',
    ownerRuleIds: ['openswan_agent_runtime'],
    matchers: [
      /^docs\/AGENT_RUNTIME_INTEGRATION_PLAN\.md$/,
      /^src\/lib\/(?:agentExecutionCore|agentRunSystem|openswanSession|openswanTaskPlanner|subagentRegistry|delegationGate|circle|skill|credentialService)/,
      /^src\/lib\/agentFailure/,
      /^scripts\/(?:agent-core|agent-failure|agent-runtime|openswan-session|openswan-task|openswan-typed|delegation|multi-agent|skill-lifecycle)/,
      /^scripts\/export-traces(?:-smoketest)?\.ts$/,
    ],
    canonicalDocs: ['docs/AGENTS_ROADMAP.md', 'docs/AGENT_RUNTIME_INTEGRATION_PLAN.md', 'docs/AGENT_TOOL_CONTRACTS_AND_EVALS_GUIDE.md'],
    dailyVerification: ['npm run smoke:openswan-task-planner', 'npm run smoke:export-traces'],
    releaseVerification: [
      'npm run smoke:agent-runtime',
      'npm run smoke:export-traces',
      'npm run smoke:openswan-session-core-adapter',
      'npm run smoke:openswan-typed-runtime-invariants',
      'npm run smoke:delegation-gate',
    ],
  },
  {
    id: 'lane4_tool_catalog_contracts',
    label: 'Lane 4 - Tool Catalog Contracts',
    purpose: 'OpenSwan tool runtime, tool schemas, approval policy, secret args, redaction, and result formatting.',
    ownerRuleIds: ['agent_tool_contract_runtime'],
    matchers: [
      /^src\/lib\/(?:openswanTool|agentToolContractStandards|opSecretArg|untrustedContent|mcpToolBridge)/,
      /^scripts\/(?:agent-tool|credentials-get|secret-op|tool-|progressive-tool|untrusted-content|mcp-tool)/,
      /^scripts\/native-module-stub\.mjs$/,
    ],
    canonicalDocs: ['docs/AGENT_TOOL_CONTRACTS_AND_EVALS_GUIDE.md'],
    dailyVerification: ['npm run smoke:agent-tool-contract-standards'],
    releaseVerification: [
      'npm run smoke:openswan-runtime-approval',
      'npm run smoke:agent-tool-contract-standards',
      'npm run smoke:credentials-get-policy',
      'npm run smoke:tool-description-lint',
      'npm run smoke:tool-result-formatters',
    ],
  },
  {
    id: 'lane5_computer_app_evidence',
    label: 'Lane 5 - Computer/App Evidence',
    purpose: 'Desktop, browser, local-file, app adapters, evidence contracts, and recovery for computer tasks.',
    ownerRuleIds: ['chat_computer_runtime', 'app_automation_control_surfaces', 'generic_app_navigation'],
    matchers: [
      /^src\/lib\/(?:appAutomation|appAdapter|agentAppCapability|genericApp|knownApp|scriptableMac|desktop|browser|computer|direct|localComputer|useComputerUse)/,
      /^scripts\/(?:app-|a11y|browser-|computer-|desktop-|direct-|generic-app|known-app|local-desktop|photoshop|scriptable-mac)/,
      /^docs\/(?:DIRECT_DESKTOP|EXECUTION_LADDER|LEARNING_LOOP|DESKTOP|UNIVERSAL_CONTROL|COMPUTER|WORDPRESS_BROWSER_AUTOMATION_RESEARCH)/,
    ],
    canonicalDocs: ['docs/AGENTIC_COMPUTER_APP_AUTOMATION_GUIDE.md'],
    dailyVerification: [
      'npm run smoke:chat-computer-request-router',
      'npm run smoke:desktop-task-ai-need',
    ],
    releaseVerification: [
      'npm run smoke:chat-computer-request-router',
      'npm run smoke:computer-task-evidence-contract',
      'npm run smoke:computer-task-evidence-recovery',
      'npm run smoke:computer-pipeline-e2e',
      'npm run smoke:direct-local-file-runtime',
      'npm run smoke:direct-image-conversion-runtime',
    ],
  },
  {
    id: 'lane6_wordpress_managed_sites',
    label: 'Lane 6 - WordPress Managed Sites',
    purpose: 'WordPress REST, wp-admin source intelligence, Dealer Inspire tasks, vault policy, and command risk.',
    ownerRuleIds: ['wordpress_site_automation'],
    matchers: [
      /^src\/lib\/(?:wordpress|wpAdmin|siteAutomation)/,
      /^scripts\/(?:wordpress|wp-command)/,
      /^docs\/WORDPRESS_/,
    ],
    canonicalDocs: ['docs/AGENTIC_COMPUTER_APP_AUTOMATION_GUIDE.md'],
    dailyVerification: [
      'npm run smoke:wordpress-admin-source-intelligence',
      'npm run smoke:wp-command-risk',
    ],
    releaseVerification: [
      'npm run smoke:swanbot-v2-wp',
      'npm run smoke:swanbot-v2-wp-approval-gate',
      'npm run smoke:wordpress-rest-payload',
      'npm run smoke:wordpress-media-upload',
      'npm run smoke:wordpress-post-type-resolver',
    ],
  },
  {
    id: 'lane7_provider_cost_routing',
    label: 'Lane 7 - Provider/Cost Routing',
    purpose: 'Provider marketplace, model routing, BYOK, edge proxy, budget, and fallback chains.',
    ownerRuleIds: ['agent_runtime_sql'],
    matchers: [
      /^src\/lib\/(?:llmProviders|serviceProfileSouls|crossProviderRouter|universalInvoke|billingPriority|blackswanRouting|marketplaceIntegrationContext)/,
      /^src\/components\/marketplace\//,
      /^supabase\/functions\/(?:llm-proxy|openrouter-rankings)/,
      /^scripts\/(?:cross-provider|fallback-chain|web-search|business-model|audit:)/,
    ],
    canonicalDocs: ['docs/AGENTS_ROADMAP.md', 'docs/OPENROUTER_INTEGRATION_RESEARCH_2026-05-06.md'],
    dailyVerification: ['npm run smoke:cross-provider-router'],
    releaseVerification: [
      'npm run smoke:cross-provider-router',
      'npm run smoke:fallback-chain',
      'npm run typecheck:functions',
    ],
  },
  {
    id: 'lane8_product_ui_console',
    label: 'Lane 8 - Product UI/Console',
    purpose: 'Chat, Office, OpenSwan, Computer Use, approval, and operations UI surfaces.',
    ownerRuleIds: ['product_ui_surfaces'],
    matchers: [
      /^src\/components\//,
      /^src\/screens\//,
      /^src\/services\/hitlService\.ts$/,
      /^src\/lib\/(?:office|approvalPayloadRenderer)/,
      /^scripts\/(?:office-|approval-payload)/,
    ],
    canonicalDocs: ['docs/DESIGN_AGENT_BEST_PRACTICES.md', 'docs/UC_STYLE_GUIDE.md'],
    dailyVerification: ['npm run smoke:office-bridge-readiness'],
    releaseVerification: [
      'npm run smoke:office-bridge-readiness',
      'npm run smoke:office-ops-board',
      'npm run smoke:approval-payload',
    ],
  },
  {
    id: 'lane9_knowledge_research',
    label: 'Lane 9 - Knowledge/Research',
    purpose: 'Wiki, second brain, research control center, memory service, and supporting research docs.',
    ownerRuleIds: ['second_brain_research_surfaces', 'planning_research_docs'],
    matchers: [
      /^src\/lib\/(?:wikiData|secondBrain|secondBrainSiteMap|digitalBrainSystemMap|memoryService|vaultAgentAccess)/,
      /^src\/screens\/wiki\//,
      /^docs\/wiki\//,
      /^docs\/(?:SWANBOT_OPENSWAN|CHAT_|LEARNING_LOOP|EXECUTION_LADDER|DIRECT_DESKTOP).*\.md$/,
      /^scripts\/second-brain-/,
    ],
    canonicalDocs: ['docs/wiki/general-wiki-index.md'],
    dailyVerification: ['npm run smoke:second-brain'],
    releaseVerification: [
      'npm run smoke:agent-standards-wiki',
      'npm run smoke:second-brain',
    ],
  },
  {
    id: 'lane10_edge_sql',
    label: 'Lane 10 - Edge SQL',
    purpose: 'Supabase functions, shared edge helpers, migrations, and consolidated SQL.',
    ownerRuleIds: ['agent_runtime_sql'],
    matchers: [
      /^supabase\/functions\//,
      /^supabase\/migrations\//,
      /^docs\/RUN_THIS_SQL\.sql$/,
    ],
    canonicalDocs: ['docs/RUN_THIS_SQL.sql', 'docs/AGENTS_ROADMAP.md'],
    dailyVerification: ['npm run typecheck:functions'],
    releaseVerification: [
      'npm run typecheck:functions',
      'npm run typecheck:app',
    ],
  },
  {
    id: 'lane99_unmapped_review',
    label: 'Lane 99 - Unmapped Review',
    purpose: 'Everything that still needs an owner before agents build on it.',
    ownerRuleIds: ['unmapped_src_lib', 'unmapped_script', 'unmapped_doc', 'general_worktree'],
    matchers: [],
    canonicalDocs: ['docs/AGENTS_ROADMAP.md'],
    dailyVerification: ['git diff --check'],
    releaseVerification: ['npm run typecheck:app', 'git diff --check'],
  },
];

function normalizeStatusPath(pathOrStatus: string): string {
  const raw = String(pathOrStatus || '').trim();
  const statusMatch = raw.match(/^(?:[ MADRCU?!]{1,2})\s+(.+)$/);
  const withoutStatus = statusMatch?.[1] || raw;
  const renameTarget = withoutStatus.includes(' -> ')
    ? withoutStatus.slice(withoutStatus.lastIndexOf(' -> ') + 4)
    : withoutStatus;
  return renameTarget
    .replace(/^"\s*/, '')
    .replace(/\s*"$/, '')
    .replace(/\\/g, '/')
    .replace(/^\.\//, '')
    .trim();
}

function gitStatusLines(repoRoot: string): string[] {
  try {
    return execFileSync('git', ['status', '--short', '-uall'], {
      cwd: repoRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).split(/\r?\n/).filter(Boolean);
  } catch {
    return [];
  }
}

function addUnique<T>(items: T[], value: T): void {
  if (!items.includes(value)) items.push(value);
}

function laneForFinding(finding: AgentWorktreePathFinding): OpenSwanLaneDefinition {
  const normalizedPath = normalizeStatusPath(finding.path);
  const matched = OPENSWAN_AGENT_LANES.find((lane) => (
    lane.id !== 'lane99_unmapped_review'
    && lane.matchers.some((matcher) => matcher.test(normalizedPath))
  ));
  if (matched) return matched;

  const ownerMatched = OPENSWAN_AGENT_LANES.find((lane) => (
    lane.id !== 'lane99_unmapped_review'
    && lane.ownerRuleIds.includes(finding.ownerRuleId)
  ));
  return ownerMatched || OPENSWAN_AGENT_LANES[OPENSWAN_AGENT_LANES.length - 1];
}

function buildBucket(lane: OpenSwanLaneDefinition): OpenSwanLaneBucket {
  return {
    lane,
    paths: [],
    ownerRuleIds: [],
    verificationCommands: [],
    canonicalDocs: [...lane.canonicalDocs],
  };
}

export function buildOpenSwanLaneReport(options: BuildOpenSwanLaneReportOptions = {}): OpenSwanLaneReport {
  const repoRoot = resolve(options.repoRoot || process.cwd());
  const taskDescription = options.taskDescription?.trim() || 'SwanBot/OpenSwan/Chat worktree cleanup';
  const statusLines = options.statusLines ?? gitStatusLines(repoRoot);
  const maxActiveLanes = options.maxActiveLanes ?? DEFAULT_MAX_ACTIVE_LANES;
  const maxChangedPaths = options.maxChangedPaths ?? DEFAULT_MAX_CHANGED_PATHS;
  const checklist = buildAgentWorktreeQualityChecklist({
    taskDescription,
    changedPaths: statusLines,
    hasUnrelatedChanges: statusLines.length > 0,
  });
  const bucketMap = new Map<OpenSwanLaneId, OpenSwanLaneBucket>();

  for (const finding of checklist.pathFindings) {
    const lane = laneForFinding(finding);
    let bucket = bucketMap.get(lane.id);
    if (!bucket) {
      bucket = buildBucket(lane);
      bucketMap.set(lane.id, bucket);
    }

    bucket.paths.push({
      path: finding.path,
      rawPath: finding.rawPath,
      ownerRuleId: finding.ownerRuleId,
      ownerLabel: finding.ownerLabel,
      isUntracked: finding.isUntracked,
    });
    addUnique(bucket.ownerRuleIds, finding.ownerRuleId);
    for (const command of finding.verificationCommands) addUnique(bucket.verificationCommands, command);
    for (const doc of finding.canonicalDocs) addUnique(bucket.canonicalDocs, doc);
  }

  const buckets = [...bucketMap.values()].sort((a, b) => (
    OPENSWAN_AGENT_LANES.findIndex((lane) => lane.id === a.lane.id)
    - OPENSWAN_AGENT_LANES.findIndex((lane) => lane.id === b.lane.id)
  ));
  const changedPathCount = checklist.pathFindings.length;
  const untrackedPathCount = checklist.pathFindings.filter((finding) => finding.isUntracked).length;
  const activeLaneCount = buckets.length;
  const status: OpenSwanLaneReportStatus = changedPathCount === 0
    ? 'clean'
    : activeLaneCount > maxActiveLanes || changedPathCount > maxChangedPaths
      ? 'broad'
      : 'narrow';

  const verificationCommands: string[] = [];
  if (status === 'broad') {
    addUnique(verificationCommands, 'npm run check:openswan-lanes');
  }
  for (const bucket of buckets) {
    for (const command of bucket.lane.dailyVerification) addUnique(verificationCommands, command);
  }
  addUnique(verificationCommands, 'npm run typecheck:app');
  addUnique(verificationCommands, 'git diff --check');

  const unmappedPaths = buckets
    .filter((bucket) => bucket.lane.id === 'lane99_unmapped_review')
    .flatMap((bucket) => bucket.paths);
  const nextActions = status === 'clean'
    ? ['No active worktree lanes. Start the next change by selecting one lane and its owner docs.']
    : status === 'narrow'
      ? [
        'Keep the branch inside the active lanes listed below.',
        'Run the lane daily verification commands before handing off.',
      ]
      : [
        'Split this checkout into smaller PRs or OpenSwan worktrees before delivery.',
        'Pick one lane as the customer-facing delivery lane; move unrelated lanes to follow-up branches.',
        'Avoid git add .; hunk-stage only the selected lane and its verification docs.',
      ];

  const summary = status === 'clean'
    ? 'No changed paths were found.'
    : status === 'narrow'
      ? `${activeLaneCount} active lane(s), ${changedPathCount} changed path(s). This is narrow enough for focused review.`
      : `${activeLaneCount} active lane(s), ${changedPathCount} changed path(s), ${untrackedPathCount} untracked path(s). This is too broad for clean delivery.`;

  return {
    taskDescription,
    status,
    activeLaneCount,
    changedPathCount,
    untrackedPathCount,
    maxActiveLanes,
    maxChangedPaths,
    summary,
    nextActions,
    buckets,
    unmappedPaths,
    verificationCommands,
    riskIds: checklist.riskIds,
  };
}

export function formatOpenSwanLaneReport(report: OpenSwanLaneReport): string {
  const lines = [
    `SwanBot/OpenSwan lane report: ${report.status}`,
    `task: ${report.taskDescription}`,
    `summary: ${report.summary}`,
    `limits: ${report.maxActiveLanes} lane(s), ${report.maxChangedPaths} path(s)`,
  ];

  if (report.nextActions.length) {
    lines.push('next actions:');
    lines.push(...report.nextActions.map((action) => `- ${action}`));
  }

  if (report.buckets.length) {
    lines.push('active lanes:');
    for (const bucket of report.buckets) {
      lines.push(`- ${bucket.lane.label}: ${bucket.paths.length} path(s)`);
      const samples = bucket.paths.slice(0, 5).map((item) => item.path);
      if (samples.length) lines.push(`  samples: ${samples.join(', ')}`);
      if (bucket.paths.length > samples.length) lines.push(`  remaining: ${bucket.paths.length - samples.length}`);
      lines.push(`  daily: ${bucket.lane.dailyVerification.join(' && ')}`);
    }
  }

  if (report.unmappedPaths.length) {
    lines.push('unmapped paths:');
    lines.push(...report.unmappedPaths.slice(0, 12).map((item) => `- ${item.path}`));
    if (report.unmappedPaths.length > 12) {
      lines.push(`- ... ${report.unmappedPaths.length - 12} more`);
    }
  }

  if (report.verificationCommands.length) {
    lines.push('verification:');
    lines.push(...report.verificationCommands.map((command) => `- ${command}`));
  }

  if (report.riskIds.length) {
    lines.push(`risks: ${report.riskIds.join(', ')}`);
  }

  return lines.join('\n');
}

function parseNumber(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    repoRoot: resolve(__dirname, '..'),
    taskDescription: 'SwanBot/OpenSwan/Chat worktree cleanup',
    format: 'summary',
    failOnBroad: false,
    maxActiveLanes: DEFAULT_MAX_ACTIVE_LANES,
    maxChangedPaths: DEFAULT_MAX_CHANGED_PATHS,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--repo') {
      options.repoRoot = resolve(argv[i + 1] || options.repoRoot);
      i += 1;
    } else if (arg === '--task') {
      options.taskDescription = argv[i + 1] || options.taskDescription;
      i += 1;
    } else if (arg === '--max-lanes') {
      options.maxActiveLanes = parseNumber(argv[i + 1], options.maxActiveLanes);
      i += 1;
    } else if (arg === '--max-paths') {
      options.maxChangedPaths = parseNumber(argv[i + 1], options.maxChangedPaths);
      i += 1;
    } else if (arg === '--json') {
      options.format = 'json';
    } else if (arg === '--fail-on-broad') {
      options.failOnBroad = true;
    } else if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    } else {
      console.error(`Unknown option: ${arg}`);
      printHelp();
      process.exit(1);
    }
  }

  return options;
}

function printHelp(): void {
  console.log([
    'Usage: npx tsx scripts/openswan-lane-report.ts [options]',
    '',
    'Options:',
    '  --repo <path>       Repo/worktree root to inspect. Defaults to this repo.',
    '  --task <text>       Task label printed in the report.',
    '  --max-lanes <n>     Active lane limit before status becomes broad. Default: 2.',
    '  --max-paths <n>     Changed path limit before status becomes broad. Default: 40.',
    '  --json              Print the full report as JSON.',
    '  --fail-on-broad     Exit 2 when the worktree is too broad.',
  ].join('\n'));
}

function main(): void {
  const options = parseArgs(process.argv.slice(2));
  const report = buildOpenSwanLaneReport({
    repoRoot: options.repoRoot,
    taskDescription: options.taskDescription,
    maxActiveLanes: options.maxActiveLanes,
    maxChangedPaths: options.maxChangedPaths,
  });

  if (options.format === 'json') {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(formatOpenSwanLaneReport(report));
  }

  if (options.failOnBroad && report.status === 'broad') process.exit(2);
}

if (require.main === module) {
  main();
}
