import { formatAgentToolContractChecklistPromptBlock } from './agentToolContractStandards';
import {
  formatOpenSwanWorktreeConfigPromptBlock,
  type OpenSwanWorktreeConfigSnapshot,
} from './openswanWorktreeConfig';

export type AgentDevelopmentStandardId =
  | 'standards_index'
  | 'coding'
  | 'typescript'
  | 'design'
  | 'modern_web'
  | 'computer_app_automation'
  | 'agent_tool_contracts'
  | 'uc_style';

export type AgentDevelopmentTaskType =
  | 'general_code'
  | 'typescript'
  | 'supabase_function'
  | 'product_ui'
  | 'web_page'
  | 'computer_app_automation'
  | 'agent_tool_contracts'
  | 'standards_wiki';

export interface AgentDevelopmentStandardDoc {
  id: AgentDevelopmentStandardId;
  title: string;
  docPath: string;
  wikiArticleId?: string;
  wikiCategory?: 'frameworks' | 'design';
  summary: string;
  keywords: string[];
  requiredDocSnippets: string[];
  requiredArticleSnippets?: string[];
  articleSearchQueries?: string[];
}

export interface AgentDevelopmentTaskRoute {
  taskType: AgentDevelopmentTaskType;
  title: string;
  summary: string;
  standardIds: AgentDevelopmentStandardId[];
  verificationCommands: string[];
  keywords: string[];
}

export interface AgentDevelopmentStandardsSummary {
  taskType: AgentDevelopmentTaskType;
  title: string;
  summary: string;
  standardIds: AgentDevelopmentStandardId[];
  standardDocPaths: string[];
  wikiArticleIds: string[];
  verificationCommands: string[];
}

export interface ApplyAgentDevelopmentStandardsOptions {
  mode?: string | null;
  taskDescription?: string | null;
  label?: string;
  changedPaths?: string[] | null;
  hasUnrelatedChanges?: boolean | null;
  worktreeConfigSnapshot?: OpenSwanWorktreeConfigSnapshot | null;
}

export type AgentWorktreeRiskId =
  | 'dirty_worktree'
  | 'untracked_canonical_file'
  | 'missing_roadmap_owner'
  | 'parallel_path_risk'
  | 'verification_gap'
  | 'cross_surface_change';

export interface AgentWorktreeOwnerRule {
  id: string;
  label: string;
  matchers: RegExp[];
  canonicalDocs: string[];
  action: string;
  verificationCommands: string[];
}

export interface AgentWorktreePathFinding {
  path: string;
  rawPath: string;
  ownerRuleId: string;
  ownerLabel: string;
  canonicalDocs: string[];
  recommendedAction: string;
  verificationCommands: string[];
  isUntracked: boolean;
}

export interface AgentWorktreeQualityChecklistOptions {
  taskDescription?: string | null;
  changedPaths?: string[] | null;
  hasUnrelatedChanges?: boolean | null;
}

export interface AgentWorktreeQualityChecklist {
  taskDescription: string;
  readOrder: string[];
  guardrails: string[];
  pathFindings: AgentWorktreePathFinding[];
  riskIds: AgentWorktreeRiskId[];
  verificationCommands: string[];
}

const AGENT_DEVELOPMENT_STANDARDS_MARKER = '=== AGENT DEVELOPMENT STANDARDS ===';
const AGENT_WORKTREE_QUALITY_MARKER = '=== AGENT WORKTREE QUALITY CHECKLIST ===';

const BASE_WORKTREE_READ_ORDER = [
  'AGENTS.md',
  'docs/AGENTS_ROADMAP.md',
  'docs/UC_APP_STACK_REFERENCE.md',
];

const BASE_WORKTREE_GUARDRAILS = [
  'Start with git status --porcelain=v1 -uall and preserve unrelated user or agent changes.',
  'Check the roadmap ownership table before adding files under src/lib, provider routing, chat automation, app automation, bridge tooling, or agent-runtime SQL.',
  'Extend an existing canonical owner when one exists; add a new owner row only when the concern is genuinely new.',
  'Keep successful user-facing chat quiet, but preserve hidden evidence, recovery, and verification metadata.',
  'Run the narrowest behavior smoke, npm run typecheck:app, and git diff --check after TypeScript app changes.',
];

const AGENT_WORKTREE_OWNER_RULES: AgentWorktreeOwnerRule[] = [
  {
    id: 'agent_standards',
    label: 'Agent development standards and app wiki',
    matchers: [
      /^docs\/AGENT_DEVELOPMENT_STANDARDS_INDEX\.md$/,
      /^docs\/(?:CODING|TYPESCRIPT|DESIGN)_AGENT_BEST_PRACTICES\.md$/,
      /^docs\/MODERN_WEB_PAGE_DESIGN_AGENT_GUIDE\.md$/,
      /^docs\/AGENTIC_COMPUTER_APP_AUTOMATION_GUIDE\.md$/,
      /^docs\/AGENT_TOOL_CONTRACTS_AND_EVALS_GUIDE\.md$/,
      /^src\/lib\/agentDevelopmentStandards\.ts$/,
      /^src\/lib\/agentToolContractStandards\.ts$/,
      /^src\/lib\/openswanWorktreeConfig\.ts$/,
      /^src\/lib\/wikiData\.ts$/,
      /^scripts\/agent-(?:standards-wiki|tool-contract-standards)-smoketest\.ts$/,
      /^scripts\/openswan-worktree-config-(?:report|smoketest)\.ts$/,
      /^scripts\/openswan-lane-report(?:-smoketest)?\.ts$/,
      /^docs\/SWANBOT_OPENSWAN_AGENT_LANES_2026-06-29\.md$/,
    ],
    canonicalDocs: [
      'docs/AGENTS_ROADMAP.md',
      'docs/AGENT_DEVELOPMENT_STANDARDS_INDEX.md',
    ],
    action: 'Keep the typed standards registry, canonical Markdown guide, app wiki article, and smoke assertions in sync.',
    verificationCommands: [
      'npm run smoke:agent-standards-wiki',
      'npm run smoke:openswan-worktree-config',
      'npm run smoke:openswan-lane-report',
      'npm run check:openswan-lanes',
      'npm run check:openswan-worktree-config',
      'npm run typecheck:app',
      'git diff --check',
    ],
  },
  {
    id: 'package_scripts_and_repo_metadata',
    label: 'Package scripts and repo metadata',
    matchers: [
      /^package(?:-lock)?\.json$/,
      /^tsconfig(?:\..+)?\.json$/,
      /^babel\.config\.js$/,
      /^metro\.config\.js$/,
      /^app\.json$/,
      /^eas\.json$/,
    ],
    canonicalDocs: [
      'AGENTS.md',
      'docs/AGENTS_ROADMAP.md',
      'docs/UC_APP_STACK_REFERENCE.md',
    ],
    action: 'Keep script, dependency, app config, and TypeScript config changes tied to the feature owner and verified with the affected smoke commands.',
    verificationCommands: [
      'npm run smoke:agent-standards-wiki',
      'npm run typecheck:app',
      'git diff --check',
    ],
  },
  {
    id: 'generic_app_navigation',
    label: 'Generic unfamiliar-app navigation',
    matchers: [
      /^src\/lib\/genericAppNavigator\.ts$/,
      /^scripts\/generic-app-navigator-smoketest\.ts$/,
    ],
    canonicalDocs: [
      'docs/AGENTS_ROADMAP.md',
      'docs/UC_APP_STACK_REFERENCE.md',
      'docs/AGENTIC_COMPUTER_APP_AUTOMATION_GUIDE.md',
    ],
    action: 'Reuse buildGenericAppNavigatorRouteContext for target-app, task-family, and readable-label detection instead of rebuilding app classifiers.',
    verificationCommands: [
      'npm run smoke:generic-app-navigator',
      'npm run smoke:app-automation-control-surfaces',
      'npm run typecheck:app',
      'git diff --check',
    ],
  },
  {
    id: 'chat_task_planning_metadata',
    label: 'Chat task planning, metadata, and task UX',
    matchers: [
      /^src\/lib\/chat(?:Actions|AgentIdentity|AgentService|AutomationPlanner|CommandRegistry|Recording|SessionArchive|SessionArchivePrompt|SessionArchiveRecovery|AgentTargets|DesignTaskCard|DesktopAttachmentRouting|RecoveryActionIntent|FailureRecovery)\.ts$/,
      /^src\/lib\/automationCadenceFormat\.ts$/,
      /^src\/lib\/chatAutomation/,
      /^src\/lib\/chatConversationalCutoverParity\.ts$/,
      /^src\/lib\/chatTerminalTransportPolicy\.ts$/,
      /^src\/lib\/chatTransportHandlers\.ts$/,
      /^src\/lib\/conversationalRouter\.ts$/,
      /^src\/lib\/messageMetadataReaders\.ts$/,
      /^src\/lib\/pendingBotMessages\.ts$/,
      /^src\/lib\/persistedChatMetadata\.ts$/,
      /^src\/lib\/recordingChatCommands\.ts$/,
      /^src\/lib\/runChatAutomationPlan\.ts$/,
      /^src\/lib\/runChatAutomationPlanObserver\.ts$/,
      /^src\/lib\/predictiveChatCommands\.ts$/,
      /^src\/lib\/userTaskPipelines\.ts$/,
      /^scripts\/(?:automation-cadence-format|chat-planner|chat-recording|persisted-chat-metadata|chat-agent-targets|chat-automation|chat-conversational|chat-design-task-card|chat-desktop-attachment-routing|chat-failure-recovery|chat-terminal|chat-transport-handlers|predictive-chat-commands|simple-chat-task-guardrails|user-task-pipelines)-smoketest\.ts$/,
      /^scripts\/check-persisted-chat-metadata\.mjs$/,
    ],
    canonicalDocs: [
      'docs/AGENTS_ROADMAP.md',
      'docs/UC_APP_STACK_REFERENCE.md',
      'docs/AGENTIC_COMPUTER_APP_AUTOMATION_GUIDE.md',
    ],
    action: 'Keep chat intent classification, command routing, metadata, recovery text, and task cards on the canonical chat automation path instead of adding one-off chat branches.',
    verificationCommands: [
      'npm run smoke:chat-planner',
      'npm run smoke:persisted-chat-metadata',
      'npm run smoke:chat-failure-recovery',
      'npm run typecheck:app',
      'git diff --check',
    ],
  },
  {
    id: 'app_automation_control_surfaces',
    label: 'App automation control-surface planning and buildout',
    matchers: [
      /^src\/lib\/appAutomationControlSurfaces\.ts$/,
      /^src\/lib\/appAdapterGapContract\.ts$/,
      /^src\/lib\/agentAppCapabilityBuildout\.ts$/,
      /^src\/lib\/designApp/,
      /^src\/lib\/engineeringCadOperationRunbooks\.ts$/,
      /^src\/lib\/adobeCreativeCloudApps\.ts$/,
      /^src\/lib\/indesignRecovery\.ts$/,
      /^scripts\/(?:app-automation-control-surfaces|app-adapter-gap-contract|app-surface-ladder|agent-app-capability-buildout|design-app-|engineering-cad|adobe-creative-cloud-apps)/,
    ],
    canonicalDocs: [
      'docs/AGENTS_ROADMAP.md',
      'docs/UC_APP_STACK_REFERENCE.md',
      'docs/AGENTIC_COMPUTER_APP_AUTOMATION_GUIDE.md',
    ],
    action: 'Keep official-source control surfaces, approval gates, evidence contracts, buildout triggers, and app-family smokes together.',
    verificationCommands: [
      'npm run smoke:app-automation-control-surfaces',
      'npm run smoke:agent-app-capability-buildout',
      'npm run typecheck:app',
      'git diff --check',
    ],
  },
  {
    id: 'chat_computer_runtime',
    label: 'Chat computer/browser/desktop runtime',
    matchers: [
      /^src\/lib\/chatComputer/,
      /^src\/lib\/chatComputerTaskAutonomy\.ts$/,
      /^src\/lib\/computer(?:App|Task|Use|File|Capability|Grant|Desktop)/,
      /^src\/lib\/appLearnedFacts\.ts$/,
      /^src\/lib\/browserActionVerification\.ts$/,
      /^src\/lib\/useComputerUse(?:Queue|Task)\.ts$/,
      /^src\/lib\/desktop(?:AI|Automation|Blocking|Bridge)/,
      /^src\/lib\/desktopTaskAiNeed\.ts$/,
      /^src\/lib\/direct(?:ImageConversion|LocalFile)Runtime\.ts$/,
      /^src\/lib\/browser(?:AI|Bridge|Task)/,
      /^src\/lib\/knownAppShortcuts\.ts$/,
      /^src\/lib\/localComputerAwarenessIntent\.ts$/,
      /^src\/lib\/scriptableMacApps\.ts$/,
      /^src\/lib\/executionSurfaceRouter\.ts$/,
      /^src\/lib\/fileSearchQuery\.ts$/,
      /^src\/lib\/scenarioPolicies\.ts$/,
      /^src\/screens\/circles\/tabs\/ChatTab\.tsx$/,
      /^scripts\/(?:a11y-tree|app-learned-facts|app-task-resolver|chat-computer|computer-app|computer-task|computer-capability-expansion|computer-grant-gate|computer-pipeline-e2e|computer-use-queue|desktop-|direct-image-conversion|direct-local-file|browser-|photoshop-save-dialog|local-desktop|scriptable-mac-apps)/,
      /^scripts\/bin\/uc-(?:ax|input)-helper(?:\.swift)?$/,
    ],
    canonicalDocs: [
      'docs/AGENTS_ROADMAP.md',
      'docs/UC_APP_STACK_REFERENCE.md',
      'docs/AGENTIC_COMPUTER_APP_AUTOMATION_GUIDE.md',
      'docs/AGENT_TOOL_CONTRACTS_AND_EVALS_GUIDE.md',
    ],
    action: 'Keep route planning, local grants, app preflight, recovery, evidence, and visible UX changes aligned so app tasks fail safe without noisy success cards.',
    verificationCommands: [
      'npm run smoke:chat-computer-request-router',
      'npm run smoke:chat-computer-request-ux',
      'npm run smoke:computer-task-evidence-contract',
      'npm run typecheck:app',
      'git diff --check',
    ],
  },
  {
    id: 'openswan_agent_runtime',
    label: 'OpenSwan agent runtime and connected-agent dispatch',
    matchers: [
      /^docs\/AGENT_RUNTIME_INTEGRATION_PLAN\.md$/,
      /^src\/lib\/openswan/,
      /^src\/lib\/agent(?!DevelopmentStandards|ToolContractStandards|AppCapabilityBuildout)/,
      /^src\/lib\/circle(?:ContextSnapshot|McpTrustSettings|SnapshotContextInjection)\.ts$/,
      /^src\/lib\/delegationGate\.ts$/,
      /^src\/lib\/mcpToolBridge\.ts$/,
      /^src\/lib\/credentialService\.ts$/,
      /^src\/lib\/skill(?:Library|PromptInjection|Lifecycle)\.ts$/,
      /^src\/lib\/swanbot\.ts$/,
      /^src\/lib\/swanbot(?:ClientToolDispatcher|OpenSwanReadiness|TurnDedupe|V2DispatcherParity|V2StopReason)\.ts$/,
      /^src\/lib\/subagentRegistry\.ts$/,
      /^src\/lib\/serviceProfileSouls\.ts$/,
      /^src\/lib\/connectionManager\.ts$/,
      /^src\/lib\/(?:codex|cursor)Detector\.ts$/,
      /^src\/lib\/customAgentBridgeDispatcher\.ts$/,
      /^src\/lib\/bridgeTaskDispatcher\.ts$/,
      /^src\/lib\/terminalAgent/,
      /^scripts\/(?:claude|codex|cursor|gemini)-bridge\.js$/,
      /^scripts\/codex-session-summary(?:-smoketest)?\.js$/,
      /^scripts\/export-traces(?:-smoketest)?\.ts$/,
      /^scripts\/terminal-launch-utils\.js$/,
      /^scripts\/(?:circle-context-snapshot|custom-agent|delegation|mcp-tool-bridge|multi-agent-dispatch|skill-lifecycle|terminal-agent|openswan|swanbot-(?:openswan|turn)|swanbot-v2|agent-(?!standards-wiki|tool-contract-standards))/,
      /^scripts\/blackswan-llm\/launchd\//,
      /^supabase\/functions\/(?:swanbot|agent|heartbeat)/,
    ],
    canonicalDocs: [
      'docs/AGENTS_ROADMAP.md',
      'docs/AGENT_RUNTIME_INTEGRATION_PLAN.md',
      'docs/UC_APP_STACK_REFERENCE.md',
      'docs/AGENT_TOOL_CONTRACTS_AND_EVALS_GUIDE.md',
    ],
    action: 'Route through the canonical OpenSwan/tool/runtime ownership table before extending connected-agent launch, recovery, delegation, or telemetry paths.',
    verificationCommands: [
      'npm run smoke:agent-core',
      'npm run smoke:agent-failure-recovery',
      'npm run smoke:agent-standards-wiki',
      'npm run smoke:export-traces',
      'npm run typecheck:app',
      'git diff --check',
    ],
  },
  {
    id: 'wordpress_site_automation',
    label: 'WordPress and managed-site automation',
    matchers: [
      /^src\/lib\/wordpress/,
      /^src\/lib\/wpAdmin\.ts$/,
      /^src\/lib\/siteAutomation\.ts$/,
      /^scripts\/(?:wordpress-.+|wp-command-risk)-smoketest\.ts$/,
      /^scripts\/swanbot-v2-wp/,
      /^docs\/WORDPRESS_/,
    ],
    canonicalDocs: [
      'docs/AGENTS_ROADMAP.md',
      'docs/UC_APP_STACK_REFERENCE.md',
      'docs/AGENTIC_COMPUTER_APP_AUTOMATION_GUIDE.md',
      'docs/AGENT_TOOL_CONTRACTS_AND_EVALS_GUIDE.md',
    ],
    action: 'Keep WordPress REST, wp-admin source intelligence, credential policy, command risk, and SwanBot v2 WordPress parity together instead of scattering site-specific automation across chat and tool runtimes.',
    verificationCommands: [
      'npm run smoke:wordpress-admin-source-intelligence',
      'npm run smoke:swanbot-v2-wp',
      'npm run smoke:wordpress-rest-payload',
      'npm run typecheck:app',
      'git diff --check',
    ],
  },
  {
    id: 'product_ui_surfaces',
    label: 'Product UI surfaces and automation status UX',
    matchers: [
      /^src\/components\//,
      /^src\/screens\//,
      /^src\/lib\/approvalPayloadRenderer\.ts$/,
      /^src\/lib\/circleOffice\.ts$/,
      /^src\/lib\/office(?:BridgeReadiness|OpsBoard)\.ts$/,
      /^src\/services\/hitlService\.ts$/,
      /^src\/components\/computer-use\//,
      /^scripts\/(?:approval-payload|office-bridge-readiness|office-ops-board|office-roster-grouping)-smoketest\.ts$/,
    ],
    canonicalDocs: [
      'docs/AGENTS_ROADMAP.md',
      'docs/UC_APP_STACK_REFERENCE.md',
      'docs/DESIGN_AGENT_BEST_PRACTICES.md',
      'docs/UC_STYLE_GUIDE.md',
    ],
    action: 'Keep user-visible status, approval, recovery, office, and console surfaces aligned with the existing app navigation and design-system rules.',
    verificationCommands: [
      'focused UI/runtime smoke when available',
      'npm run smoke:approval-payload',
      'npm run typecheck:app',
      'git diff --check',
    ],
  },
  {
    id: 'second_brain_research_surfaces',
    label: 'Second brain, wiki, and research surfaces',
    matchers: [
      /^src\/lib\/(?:secondBrain|secondBrainCore|secondBrainSiteMap|digitalBrainSystemMap|researchControl|vaultAgentAccess)\.ts$/,
      /^src\/lib\/memoryService\.ts$/,
      /^src\/components\/SecondBrainDashboard\.tsx$/,
      /^src\/screens\/wiki\//,
      /^scripts\/second-brain-smoketest\.ts$/,
      /^docs\/wiki\/chat-and-task-automation-deep-research-.+\.md$/,
      /^docs\/wiki\/(?:general-wiki-index|nikola-tesla).+\.md$/,
      /^docs\/wiki\/general-wiki-index\.md$/,
    ],
    canonicalDocs: [
      'docs/AGENTS_ROADMAP.md',
      'docs/UC_APP_STACK_REFERENCE.md',
    ],
    action: 'Keep research, wiki, second-brain maps, and vault access together so knowledge surfaces stay discoverable from the app.',
    verificationCommands: [
      'npm run smoke:second-brain',
      'npm run typecheck:app',
      'git diff --check',
    ],
  },
  {
    id: 'planning_research_docs',
    label: 'Planning, research, and implementation direction docs',
    matchers: [
      /^docs\/(?:CHAT_APP_AUTOMATION_DIRECTION|CHAT_AUTOMATION_AUDIT_PLAN|CURSOR_AGENT_FEATURE_PARITY_PLAN|DESKTOP_MANIPULATION_PLAN|DIRECT_DESKTOP_TASK_EXPANSION_RESEARCH|EXECUTION_LADDER_RESEARCH|LEARNING_LOOP_RESEARCH|SWANBOT_OPENSWAN_|SWANBOT_PIPELINE_RESEARCH|SWANBOT_V2_MIGRATION_PLAN)/,
      /^docs\/wiki\/(?:agent-tool-contracts-and-evals|agentic-computer-app-automation)-.+\.md$/,
      /^docs\/UC_STYLE_GUIDE\.md$/,
    ],
    canonicalDocs: [
      'docs/AGENTS_ROADMAP.md',
      'docs/UC_APP_STACK_REFERENCE.md',
      'docs/AGENT_DEVELOPMENT_STANDARDS_INDEX.md',
    ],
    action: 'Treat planning and research docs as supporting context; keep the roadmap as the source of truth when implementation direction changes.',
    verificationCommands: [
      'npm run smoke:agent-standards-wiki',
      'npm run typecheck:app',
      'git diff --check',
    ],
  },
  {
    id: 'canonical_docs',
    label: 'Canonical roadmap and stack documentation',
    matchers: [
      /^AGENTS\.md$/,
      /^AGENT\.md$/,
      /^CLAUDE\.md$/,
      /^Gemini\.md$/,
      /^MEMORY\.md$/,
      /^docs\/AGENTS_ROADMAP\.md$/,
      /^docs\/UC_APP_STACK_REFERENCE\.md$/,
    ],
    canonicalDocs: [
      'AGENTS.md',
      'docs/AGENTS_ROADMAP.md',
      'docs/UC_APP_STACK_REFERENCE.md',
    ],
    action: 'Keep the read order and roadmap ownership table authoritative; update downstream docs in the same change when direction shifts.',
    verificationCommands: [
      'npm run smoke:agent-standards-wiki',
      'npm run typecheck:app',
      'git diff --check',
    ],
  },
  {
    id: 'agent_runtime_sql',
    label: 'Agent/runtime SQL and Supabase migrations',
    matchers: [
      /^supabase\/migrations\//,
      /^docs\/RUN_THIS_SQL\.sql$/,
      /^supabase\/functions\//,
    ],
    canonicalDocs: [
      'docs/AGENTS_ROADMAP.md',
      'docs/RUN_THIS_SQL.sql',
    ],
    action: 'Update the migration, consolidated SQL checklist when applicable, and function/typecheck coverage together.',
    verificationCommands: [
      'npm run typecheck:functions',
      'npm run typecheck:app',
      'git diff --check',
    ],
  },
  {
    id: 'agent_tool_contract_runtime',
    label: 'OpenSwan tool contracts, policy, and redaction',
    matchers: [
      /^src\/lib\/agentToolContractStandards\.ts$/,
      /^src\/lib\/opSecretArg\.ts$/,
      /^src\/lib\/untrustedContent\.ts$/,
      /^scripts\/native-module-stub\.mjs$/,
      /^scripts\/(?:agent-tool-contract-standards|credentials-get-policy|secret-op-arg|tool-batch-parallelism|tool-description-lint|tool-result-formatters|untrusted-content)-smoketest\.ts$/,
      /^scripts\/progressive-tool-disclosure-smoketest\.ts$/,
    ],
    canonicalDocs: [
      'docs/AGENTS_ROADMAP.md',
      'docs/AGENT_TOOL_CONTRACTS_AND_EVALS_GUIDE.md',
    ],
    action: 'Keep tool schemas, approval policy, secret redaction, untrusted-content handling, progressive disclosure, and result-format smokes synchronized with the OpenSwan catalog.',
    verificationCommands: [
      'npm run smoke:agent-tool-contract-standards',
      'npm run smoke:credentials-get-policy',
      'npm run smoke:tool-description-lint',
      'npm run typecheck:app',
      'git diff --check',
    ],
  },
];

export const AGENT_DEVELOPMENT_STANDARD_DOCS: AgentDevelopmentStandardDoc[] = [
  {
    id: 'standards_index',
    title: 'Agent Development Standards Index',
    docPath: 'docs/AGENT_DEVELOPMENT_STANDARDS_INDEX.md',
    wikiArticleId: 'agent-development-standards-index',
    wikiCategory: 'frameworks',
    summary: 'Task-based routing across coding, TypeScript, design, web-page, computer/app automation, tool-contract/eval, and local style standards.',
    keywords: ['agent standards', 'development standards', 'coding standards', 'verification'],
    requiredDocSnippets: [
      'docs/CODING_AGENT_BEST_PRACTICES.md',
      'docs/TYPESCRIPT_AGENT_BEST_PRACTICES.md',
      'docs/DESIGN_AGENT_BEST_PRACTICES.md',
      'docs/MODERN_WEB_PAGE_DESIGN_AGENT_GUIDE.md',
      'docs/AGENTIC_COMPUTER_APP_AUTOMATION_GUIDE.md',
      'docs/AGENT_TOOL_CONTRACTS_AND_EVALS_GUIDE.md',
      'Runtime Handoff Wiring',
      'Worktree Integration Checklist',
      'applyAgentDevelopmentStandardsToPrompt',
      'buildAgentWorktreeQualityChecklist',
      'src/lib/openswanWorktreeConfig.ts',
      'buildOpenSwanWorktreeConfigSnapshot',
      'worktreeConfigSnapshot',
      'check:openswan-worktree-config',
      'check:openswan-lanes',
      'check:swanbot-chat:daily',
      'report:swanbot-openswan-readiness',
      'smoke:openswan-lane-report',
      'SWANBOT_OPENSWAN_AGENT_LANES_2026-06-29.md',
      'appendOpenSwanWorktreeConfigPrompt',
      'npm run smoke:agent-standards-wiki',
    ],
    requiredArticleSnippets: [
      'docs/AGENT_DEVELOPMENT_STANDARDS_INDEX.md',
      'Worktree Integration Checklist',
      'buildOpenSwanWorktreeConfigSnapshot',
      'worktreeConfigSnapshot',
      'check:openswan-worktree-config',
      'check:openswan-lanes',
      'check:swanbot-chat:daily',
      'report:swanbot-openswan-readiness',
      'smoke:openswan-lane-report',
      'terminal-launch-utils',
      'smoke:agent-standards-wiki',
    ],
    articleSearchQueries: ['agent standards', 'development standards', 'coding standards'],
  },
  {
    id: 'coding',
    title: 'Coding Agent Best Practices',
    docPath: 'docs/CODING_AGENT_BEST_PRACTICES.md',
    wikiArticleId: 'coding-best-practices-for-agents',
    wikiCategory: 'frameworks',
    summary: 'General code quality, security, testing, review, change-shape, and handoff standards.',
    keywords: ['coding best practices', 'code quality', 'secure coding', 'testing', 'review'],
    requiredDocSnippets: [
      'docs/TYPESCRIPT_AGENT_BEST_PRACTICES.md',
      'docs/AGENT_DEVELOPMENT_STANDARDS_INDEX.md',
      'OWASP Secure Coding Practices',
    ],
    requiredArticleSnippets: [
      'docs/CODING_AGENT_BEST_PRACTICES.md',
      'OWASP secure coding',
    ],
    articleSearchQueries: ['coding best practices', 'secure coding', 'engineering standards'],
  },
  {
    id: 'typescript',
    title: 'TypeScript Agent Best Practices',
    docPath: 'docs/TYPESCRIPT_AGENT_BEST_PRACTICES.md',
    wikiArticleId: 'typescript-agent-best-practices',
    wikiCategory: 'frameworks',
    summary: 'Strict typing, boundary parsing, unions, React Native / Expo, and TypeScript verification.',
    keywords: ['typescript', 'typescript strict', 'type-safety', 'react native', 'expo'],
    requiredDocSnippets: [
      'docs/CODING_AGENT_BEST_PRACTICES.md',
      'strict: true',
      'npm run typecheck:app',
    ],
    requiredArticleSnippets: [
      'docs/TYPESCRIPT_AGENT_BEST_PRACTICES.md',
      'npm run typecheck:app',
    ],
    articleSearchQueries: ['typescript strict', 'type-safety', 'verification'],
  },
  {
    id: 'design',
    title: 'Design Agent Best Practices',
    docPath: 'docs/DESIGN_AGENT_BEST_PRACTICES.md',
    wikiArticleId: 'design-best-practices-for-agents',
    wikiCategory: 'design',
    summary: 'Product design, design-system, UX writing, automation UI, state, proof, and recovery standards.',
    keywords: ['design best practices', 'product design', 'design systems', 'ux writing', 'automation ui'],
    requiredDocSnippets: [
      'docs/AGENT_DEVELOPMENT_STANDARDS_INDEX.md',
      'docs/MODERN_WEB_PAGE_DESIGN_AGENT_GUIDE.md',
      'docs/UC_STYLE_GUIDE.md',
    ],
    requiredArticleSnippets: [
      'docs/DESIGN_AGENT_BEST_PRACTICES.md',
      'Design System Discipline',
    ],
    articleSearchQueries: ['design best practices', 'product design', 'automation ui'],
  },
  {
    id: 'modern_web',
    title: 'Modern Web Page Design Agent Guide',
    docPath: 'docs/MODERN_WEB_PAGE_DESIGN_AGENT_GUIDE.md',
    wikiArticleId: 'modern-web-page-design-for-agents',
    wikiCategory: 'design',
    summary: 'Web-page structure, responsive layout, accessibility, performance, forms, media, and motion.',
    keywords: ['modern web design', 'web page design', 'responsive design', 'core web vitals', 'wcag'],
    requiredDocSnippets: [
      'docs/DESIGN_AGENT_BEST_PRACTICES.md',
      'Core Web Vitals',
      'WCAG 2.2',
    ],
    requiredArticleSnippets: [
      'docs/MODERN_WEB_PAGE_DESIGN_AGENT_GUIDE.md',
      'Core Web Vitals',
    ],
    articleSearchQueries: ['modern web design', 'responsive design', 'core web vitals'],
  },
  {
    id: 'computer_app_automation',
    title: 'Agentic Computer/App Automation Guide',
    docPath: 'docs/AGENTIC_COMPUTER_APP_AUTOMATION_GUIDE.md',
    wikiArticleId: 'agentic-computer-app-automation-for-agents',
    wikiCategory: 'frameworks',
    summary: 'Browser, desktop, local-file, native-app, Adobe/CAD, bridge, approval, evidence, recovery, and connected-agent buildout standards.',
    keywords: [
      'computer use',
      'browser automation',
      'desktop automation',
      'app automation',
      'adobe',
      'cad',
      'bridge',
      'approval',
      'evidence',
      'recovery',
    ],
    requiredDocSnippets: [
      'Observe State Before Action',
      'Approval Gates',
      'Evidence Contract',
      'Fail Safe With Recovery Options',
      'Connected-Agent Buildout',
      'Anthropic, Building effective agents',
      'OWASP Top 10 for Agentic Applications 2026',
      'Adobe InDesign UXP scripts',
    ],
    requiredArticleSnippets: [
      'docs/AGENTIC_COMPUTER_APP_AUTOMATION_GUIDE.md',
      'semantic, evidence-first automation ladder',
      'Connected code agents build missing adapters',
    ],
    articleSearchQueries: [
      'computer app automation',
      'desktop automation',
      'browser automation',
      'photoshop',
    ],
  },
  {
    id: 'agent_tool_contracts',
    title: 'Agent Tool Contracts And Evals Guide',
    docPath: 'docs/AGENT_TOOL_CONTRACTS_AND_EVALS_GUIDE.md',
    wikiArticleId: 'agent-tool-contracts-and-evals-for-agents',
    wikiCategory: 'frameworks',
    summary: 'OpenSwan, bridge, MCP, connected-agent tool schema, structured result, approval, redaction, recovery, retryability, and eval standards.',
    keywords: [
      'tool contract',
      'tool schema',
      'openswan tool',
      'mcp tool',
      'bridge tool',
      'approval metadata',
      'structured result',
      'recovery eval',
      'redaction',
      'negative path',
    ],
    requiredDocSnippets: [
      'Tool Contract Checklist',
      'Schema Rules',
      'Approval And Consent',
      'Recovery Contract',
      'Eval Matrix',
      'src/lib/agentToolContractStandards.ts',
      'npm run smoke:agent-tool-contract-standards',
      'Anthropic, Writing effective tools for agents',
      'Model Context Protocol tools specification',
      'OWASP Top 10 for Agentic Applications 2026',
    ],
    requiredArticleSnippets: [
      'docs/AGENT_TOOL_CONTRACTS_AND_EVALS_GUIDE.md',
      'src/lib/agentToolContractStandards.ts',
      'agent-facing contracts with clear names',
      'approval metadata, redaction, or tool result contracts',
    ],
    articleSearchQueries: [
      'tool contract',
      'agent tool evals',
      'mcp tool',
      'recovery eval',
    ],
  },
  {
    id: 'uc_style',
    title: 'UC Style Guide',
    docPath: 'docs/UC_STYLE_GUIDE.md',
    summary: 'Local UC visual tokens for dark surfaces, color, typography, radius, cards, buttons, and inputs.',
    keywords: ['uc style', 'visual tokens', 'dark mode', 'color palette', 'buttons', 'cards'],
    requiredDocSnippets: [
      'DESIGN_AGENT_BEST_PRACTICES.md',
      'MODERN_WEB_PAGE_DESIGN_AGENT_GUIDE.md',
    ],
  },
];

export const AGENT_DEVELOPMENT_TASK_ROUTES: AgentDevelopmentTaskRoute[] = [
  {
    taskType: 'general_code',
    title: 'General Code Change',
    summary: 'Use for ordinary implementation, bug fixes, refactors, scripts, and runtime changes.',
    standardIds: ['coding'],
    verificationCommands: ['focused smoke for changed behavior', 'npm run typecheck:app', 'git diff --check'],
    keywords: ['code', 'bug', 'refactor', 'runtime', 'script', 'implementation'],
  },
  {
    taskType: 'typescript',
    title: 'TypeScript App Or Runtime Change',
    summary: 'Use for TypeScript, React Native / Expo, app runtime, planner, bridge, and wiki data changes.',
    standardIds: ['coding', 'typescript'],
    verificationCommands: ['focused smoke when behavior changes', 'npm run typecheck:app', 'git diff --check'],
    keywords: ['typescript', 'tsx', 'type', 'react native', 'expo', 'wiki data', 'runtime', 'planner', 'bridge'],
  },
  {
    taskType: 'supabase_function',
    title: 'Supabase Function Change',
    summary: 'Use for Supabase edge functions, shared edge helpers, and function-facing provider code.',
    standardIds: ['coding', 'typescript'],
    verificationCommands: ['npm run typecheck:functions', 'targeted function smoke when available', 'git diff --check'],
    keywords: ['supabase', 'edge function', 'deno', 'llm-proxy', 'database function'],
  },
  {
    taskType: 'product_ui',
    title: 'Product UI Or Automation Surface',
    summary: 'Use for screens, flows, approval cards, recovery UI, dashboards, chat cards, and automation UI.',
    standardIds: ['design', 'uc_style'],
    verificationCommands: ['focused UI/runtime smoke when available', 'npm run typecheck:app', 'git diff --check'],
    keywords: ['ui', 'ux', 'screen', 'card', 'approval', 'recovery', 'dashboard', 'chat'],
  },
  {
    taskType: 'web_page',
    title: 'Web Page Or Dashboard',
    summary: 'Use for web pages, landing pages, documentation pages, dashboards, and app shells.',
    standardIds: ['modern_web', 'design', 'uc_style'],
    verificationCommands: ['mobile/desktop inspection', 'accessibility pass', 'npm run typecheck:app', 'git diff --check'],
    keywords: ['web page', 'landing page', 'responsive', 'dashboard', 'forms', 'accessibility', 'core web vitals'],
  },
  {
    taskType: 'computer_app_automation',
    title: 'Browser Desktop Or App Automation',
    summary: 'Use for browser, desktop, local-file, native-app, Adobe/CAD, bridge, approval, evidence, recovery, and connected-agent adapter buildout work.',
    standardIds: ['coding', 'typescript', 'design', 'computer_app_automation'],
    verificationCommands: [
      'npm run smoke:chat-computer-request-router',
      'npm run smoke:app-automation-control-surfaces',
      'npm run smoke:computer-task-evidence-contract',
      'npm run typecheck:app',
      'git diff --check',
    ],
    keywords: [
      'computer use',
      'browser automation',
      'desktop automation',
      'app automation',
      'desktop',
      'browser',
      'local file',
      'uploaded file',
      'native app',
      'photoshop',
      'indesign',
      'adobe',
      'autocad',
      'cad',
      'engineering app',
      'bridge',
      'app adapter',
      'control surface',
      'evidence',
      'approval',
      'recovery',
      'connected agent buildout',
    ],
  },
  {
    taskType: 'agent_tool_contracts',
    title: 'Agent Tool Contract Or Eval Change',
    summary: 'Use for OpenSwan, bridge, MCP, connected-agent tool schemas, structured results, approval metadata, recovery, redaction, retryability, and eval coverage.',
    standardIds: ['coding', 'typescript', 'computer_app_automation', 'agent_tool_contracts'],
    verificationCommands: [
      'tool-specific smoke for changed behavior',
      'approval/recovery negative-path smoke when privileged',
      'npm run smoke:agent-standards-wiki',
      'npm run typecheck:app',
      'git diff --check',
    ],
    keywords: [
      'tool contract',
      'tool schema',
      'tool result',
      'structured result',
      'openswan tool',
      'mcp tool',
      'bridge tool',
      'desktop tool',
      'browser tool',
      'agent tool',
      'custom agent tool',
      'connected agent dispatch',
      'approval metadata',
      'redaction',
      'retryability',
      'idempotency',
      'recovery eval',
      'negative path',
      'golden task',
      'eval suite',
      'smoke coverage',
    ],
  },
  {
    taskType: 'standards_wiki',
    title: 'Standards Or Wiki Content',
    summary: 'Use when changing standards docs or their app wiki mirrors.',
    standardIds: ['standards_index'],
    verificationCommands: ['npm run smoke:agent-standards-wiki', 'npm run typecheck:app', 'git diff --check'],
    keywords: ['standards', 'wiki', 'agent guide', 'documentation', 'best practices'],
  },
];

function addUniqueItems<T>(items: T[], values: T[]): T[] {
  const next = [...items];
  for (const value of values) {
    if (!next.includes(value)) next.push(value);
  }
  return next;
}

function normalizeAgentWorktreePath(pathOrStatus: string): string {
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

function isUntrackedAgentWorktreePath(pathOrStatus: string): boolean {
  return String(pathOrStatus || '').trim().startsWith('?? ');
}

function getAgentWorktreeOwnerRule(path: string): AgentWorktreeOwnerRule {
  const normalized = normalizeAgentWorktreePath(path);
  const matched = AGENT_WORKTREE_OWNER_RULES.find((rule) => (
    rule.matchers.some((matcher) => matcher.test(normalized))
  ));
  if (matched) return matched;

  if (/^src\/lib\/.+\.tsx?$/.test(normalized)) {
    return {
      id: 'unmapped_src_lib',
      label: 'Unmapped src/lib runtime helper',
      matchers: [],
      canonicalDocs: [
        'docs/AGENTS_ROADMAP.md',
        'docs/UC_APP_STACK_REFERENCE.md',
      ],
      action: 'Find the nearest existing owner in the roadmap before adding another helper; add an ownership row if this concern is genuinely new.',
      verificationCommands: [
        'focused smoke for changed behavior',
        'npm run typecheck:app',
        'git diff --check',
      ],
    };
  }

  if (/^scripts\/.+/.test(normalized)) {
    return {
      id: 'unmapped_script',
      label: 'Unmapped script or smoke helper',
      matchers: [],
      canonicalDocs: [
        'docs/AGENTS_ROADMAP.md',
        'package.json',
      ],
      action: 'Wire scripts through package.json only when they are repeatable; pair behavior scripts with focused smoke coverage.',
      verificationCommands: [
        'targeted script smoke',
        'npm run typecheck:app',
        'git diff --check',
      ],
    };
  }

  if (/^docs\//.test(normalized)) {
    return {
      id: 'unmapped_doc',
      label: 'Unmapped documentation',
      matchers: [],
      canonicalDocs: [
        'AGENTS.md',
        'docs/AGENTS_ROADMAP.md',
      ],
      action: 'Keep docs aligned with the roadmap and update the owning typed helper or smoke when the doc describes runtime behavior.',
      verificationCommands: [
        'docs-focused smoke when available',
        'git diff --check',
      ],
    };
  }

  return {
    id: 'general_worktree',
    label: 'General worktree file',
    matchers: [],
    canonicalDocs: [
      'AGENTS.md',
      'docs/AGENTS_ROADMAP.md',
    ],
    action: 'Keep the change scoped, preserve unrelated work, and run the narrowest available verification.',
    verificationCommands: [
      'focused verification for changed behavior',
      'git diff --check',
    ],
  };
}

function inferAgentWorktreeRiskIds(
  pathFindings: AgentWorktreePathFinding[],
  opts: AgentWorktreeQualityChecklistOptions,
): AgentWorktreeRiskId[] {
  const riskIds: AgentWorktreeRiskId[] = [];
  const ownerIds = new Set(pathFindings.map((finding) => finding.ownerRuleId));
  const sourceChanges = pathFindings.some((finding) => /^(src|scripts|supabase)\//.test(finding.path));
  const smokeChanges = pathFindings.some((finding) => /(?:smoke|test|spec)/i.test(finding.path));

  if (opts.hasUnrelatedChanges || pathFindings.length > 20) riskIds.push('dirty_worktree');
  if (pathFindings.some((finding) => finding.isUntracked && /^(src|scripts|docs|supabase)\//.test(finding.path))) {
    riskIds.push('untracked_canonical_file');
  }
  if (pathFindings.some((finding) => /^unmapped_/.test(finding.ownerRuleId))) {
    riskIds.push('missing_roadmap_owner');
  }
  if (pathFindings.some((finding) => finding.ownerRuleId === 'unmapped_src_lib')) {
    riskIds.push('parallel_path_risk');
  }
  if (sourceChanges && !smokeChanges) riskIds.push('verification_gap');
  if (ownerIds.size > 1) riskIds.push('cross_surface_change');

  return riskIds;
}

export function buildAgentWorktreeQualityChecklist(
  opts: AgentWorktreeQualityChecklistOptions = {},
): AgentWorktreeQualityChecklist {
  const taskDescription = String(opts.taskDescription || '').trim();
  const rawPaths = (opts.changedPaths || [])
    .map((path) => String(path || '').trim())
    .filter(Boolean);
  const pathFindings = rawPaths.map((rawPath) => {
    const path = normalizeAgentWorktreePath(rawPath);
    const ownerRule = getAgentWorktreeOwnerRule(path);
    return {
      path,
      rawPath,
      ownerRuleId: ownerRule.id,
      ownerLabel: ownerRule.label,
      canonicalDocs: ownerRule.canonicalDocs,
      recommendedAction: ownerRule.action,
      verificationCommands: ownerRule.verificationCommands,
      isUntracked: isUntrackedAgentWorktreePath(rawPath),
    };
  });

  const taskRoute = taskDescription ? inferAgentDevelopmentTaskRoute(taskDescription) : null;
  const routeDocs = taskRoute ? getStandardsForTaskType(taskRoute.taskType).map((standard) => standard.docPath) : [];
  const routeVerification = taskRoute?.verificationCommands || [];
  const pathDocs = pathFindings.flatMap((finding) => finding.canonicalDocs);
  const pathVerification = pathFindings.flatMap((finding) => finding.verificationCommands);

  return {
    taskDescription,
    readOrder: addUniqueItems(BASE_WORKTREE_READ_ORDER, [...routeDocs, ...pathDocs]),
    guardrails: BASE_WORKTREE_GUARDRAILS,
    pathFindings,
    riskIds: inferAgentWorktreeRiskIds(pathFindings, opts),
    verificationCommands: addUniqueItems(
      addUniqueItems(routeVerification, pathVerification),
      ['npm run typecheck:app', 'git diff --check'],
    ),
  };
}

export function formatAgentWorktreeQualityChecklistPromptBlock(
  checklist: AgentWorktreeQualityChecklist,
): string {
  const readOrder = checklist.readOrder.map((item) => `- ${item}`).join('\n');
  const guardrails = checklist.guardrails.map((item) => `- ${item}`).join('\n');
  const riskIds = checklist.riskIds.length
    ? checklist.riskIds.map((riskId) => `- ${riskId}`).join('\n')
    : '- none_detected';
  const verification = checklist.verificationCommands.map((command) => `- ${command}`).join('\n');
  const displayedFindings = checklist.pathFindings.slice(0, 12);
  const findings = displayedFindings.length
    ? displayedFindings.map((finding) => (
      `- ${finding.path}: ${finding.ownerLabel}; ${finding.recommendedAction}`
    )).join('\n')
    : '- No changed paths were provided. Run git status --porcelain=v1 -uall before editing.';
  const remaining = checklist.pathFindings.length > displayedFindings.length
    ? `\n- ${checklist.pathFindings.length - displayedFindings.length} more changed paths omitted from this prompt block.`
    : '';

  return [
    AGENT_WORKTREE_QUALITY_MARKER,
    checklist.taskDescription ? `Task: ${checklist.taskDescription}` : 'Task: infer from current user request',
    'Read order:',
    readOrder,
    'Guardrails:',
    guardrails,
    'Changed path ownership:',
    `${findings}${remaining}`,
    'Risk flags:',
    riskIds,
    'Verify:',
    verification,
  ].join('\n');
}

export function buildAgentWorktreeQualityPromptBlock(
  opts: AgentWorktreeQualityChecklistOptions = {},
): string {
  return formatAgentWorktreeQualityChecklistPromptBlock(
    buildAgentWorktreeQualityChecklist(opts),
  );
}

export function listAgentDevelopmentStandards(): AgentDevelopmentStandardDoc[] {
  return [...AGENT_DEVELOPMENT_STANDARD_DOCS];
}

export function getAgentDevelopmentStandard(
  id: AgentDevelopmentStandardId,
): AgentDevelopmentStandardDoc | undefined {
  return AGENT_DEVELOPMENT_STANDARD_DOCS.find((standard) => standard.id === id);
}

export function getAgentDevelopmentStandardByWikiArticleId(
  wikiArticleId: string,
): AgentDevelopmentStandardDoc | undefined {
  return AGENT_DEVELOPMENT_STANDARD_DOCS.find((standard) => standard.wikiArticleId === wikiArticleId);
}

export function listAgentDevelopmentTaskRoutes(): AgentDevelopmentTaskRoute[] {
  return [...AGENT_DEVELOPMENT_TASK_ROUTES];
}

export function getAgentDevelopmentTaskRoute(
  taskType: AgentDevelopmentTaskType,
): AgentDevelopmentTaskRoute | undefined {
  return AGENT_DEVELOPMENT_TASK_ROUTES.find((route) => route.taskType === taskType);
}

export function getStandardsForTaskType(
  taskType: AgentDevelopmentTaskType,
): AgentDevelopmentStandardDoc[] {
  const route = getAgentDevelopmentTaskRoute(taskType);
  if (!route) return [];
  return route.standardIds
    .map((id) => getAgentDevelopmentStandard(id))
    .filter((standard): standard is AgentDevelopmentStandardDoc => Boolean(standard));
}

function scoreAgentDevelopmentTaskRoutes(query: string): Array<{
  route: AgentDevelopmentTaskRoute;
  score: number;
  specificity: number;
  index: number;
}> {
  const normalized = query.toLowerCase();
  return AGENT_DEVELOPMENT_TASK_ROUTES
    .map((route, index) => {
      const score = route.keywords.reduce(
        (total, keyword) => total + (normalized.includes(keyword) ? 1 : 0),
        0,
      );
      return {
        route,
        score,
        specificity: route.standardIds.length,
        index,
      };
    })
    .sort((a, b) => (
      b.score - a.score ||
      b.specificity - a.specificity ||
      a.index - b.index
    ));
}

export function inferAgentDevelopmentTaskRoute(
  query: string,
  opts: { mode?: string | null } = {},
): AgentDevelopmentTaskRoute | null {
  const scored = scoreAgentDevelopmentTaskRoutes(query);
  if (scored[0]?.score) return scored[0].route;

  const mode = (opts.mode || '').toLowerCase();
  if (mode === 'design') return getAgentDevelopmentTaskRoute('product_ui') || null;
  if (mode === 'build' || mode === 'review' || mode === 'execute') {
    return getAgentDevelopmentTaskRoute('general_code') || null;
  }

  return null;
}

export function resolveAgentDevelopmentTaskRoute(query: string): AgentDevelopmentTaskRoute {
  const inferred = inferAgentDevelopmentTaskRoute(query);
  if (inferred) return inferred;

  return AGENT_DEVELOPMENT_TASK_ROUTES[0];
}

export function summarizeAgentDevelopmentStandardsRoute(
  route: AgentDevelopmentTaskRoute,
): AgentDevelopmentStandardsSummary {
  const standards = getStandardsForTaskType(route.taskType);
  return {
    taskType: route.taskType,
    title: route.title,
    summary: route.summary,
    standardIds: route.standardIds,
    standardDocPaths: standards.map((standard) => standard.docPath),
    wikiArticleIds: standards
      .map((standard) => standard.wikiArticleId)
      .filter((id): id is string => Boolean(id)),
    verificationCommands: route.verificationCommands,
  };
}

export function summarizeRelevantAgentDevelopmentStandards(
  taskDescription: string,
  opts: { mode?: string | null } = {},
): AgentDevelopmentStandardsSummary | null {
  const route = inferAgentDevelopmentTaskRoute(taskDescription, opts);
  return route ? summarizeAgentDevelopmentStandardsRoute(route) : null;
}

export function formatAgentDevelopmentStandardsPromptBlock(
  route: AgentDevelopmentTaskRoute,
  taskDescription?: string,
  opts: Pick<AgentWorktreeQualityChecklistOptions, 'changedPaths' | 'hasUnrelatedChanges'> & {
    worktreeConfigSnapshot?: OpenSwanWorktreeConfigSnapshot | null;
  } = {},
): string {
  const standards = getStandardsForTaskType(route.taskType);
  const docs = standards.map((standard) => `- ${standard.title} (${standard.docPath}): ${standard.summary}`).join('\n');
  const verification = route.verificationCommands.map((command) => `- ${command}`).join('\n');
  const extraContractBlock = route.taskType === 'agent_tool_contracts'
    ? ['', formatAgentToolContractChecklistPromptBlock(taskDescription || route.summary)]
    : [];
  const worktreeBlock = formatAgentWorktreeQualityChecklistPromptBlock(
    buildAgentWorktreeQualityChecklist({
      taskDescription: taskDescription || route.summary,
      changedPaths: opts.changedPaths,
      hasUnrelatedChanges: opts.hasUnrelatedChanges,
    }),
  );
  const worktreeConfigBlock = opts.worktreeConfigSnapshot
    ? ['', formatOpenSwanWorktreeConfigPromptBlock(opts.worktreeConfigSnapshot)]
    : [];

  return [
    '=== AGENT DEVELOPMENT STANDARDS ===',
    `Task route: ${route.title}`,
    `Why: ${route.summary}`,
    'Read:',
    docs || '- docs/AGENT_DEVELOPMENT_STANDARDS_INDEX.md',
    'Verify:',
    verification,
    '',
    worktreeBlock,
    ...worktreeConfigBlock,
    ...extraContractBlock,
  ].join('\n');
}

export function buildAgentDevelopmentStandardsPromptBlock(
  taskDescription: string,
  opts: Pick<AgentWorktreeQualityChecklistOptions, 'changedPaths' | 'hasUnrelatedChanges'> & {
    worktreeConfigSnapshot?: OpenSwanWorktreeConfigSnapshot | null;
  } = {},
): string {
  return formatAgentDevelopmentStandardsPromptBlock(
    resolveAgentDevelopmentTaskRoute(taskDescription),
    taskDescription,
    opts,
  );
}

export function buildRelevantAgentDevelopmentStandardsPromptBlock(
  taskDescription: string,
  opts: {
    mode?: string | null;
    changedPaths?: string[] | null;
    hasUnrelatedChanges?: boolean | null;
    worktreeConfigSnapshot?: OpenSwanWorktreeConfigSnapshot | null;
  } = {},
): string | null {
  const route = inferAgentDevelopmentTaskRoute(taskDescription, opts);
  return route ? formatAgentDevelopmentStandardsPromptBlock(route, taskDescription, opts) : null;
}

export function hasAgentDevelopmentStandardsPromptBlock(prompt: string): boolean {
  return String(prompt || '').includes(AGENT_DEVELOPMENT_STANDARDS_MARKER);
}

export function applyAgentDevelopmentStandardsToPrompt(
  prompt: string,
  opts: ApplyAgentDevelopmentStandardsOptions = {},
): string {
  const cleanPrompt = String(prompt || '').trim();
  if (!cleanPrompt || hasAgentDevelopmentStandardsPromptBlock(cleanPrompt)) return cleanPrompt;

  const taskDescription = String(opts.taskDescription || cleanPrompt).trim();
  const block = buildRelevantAgentDevelopmentStandardsPromptBlock(taskDescription, {
    mode: opts.mode,
    changedPaths: opts.changedPaths,
    hasUnrelatedChanges: opts.hasUnrelatedChanges,
    worktreeConfigSnapshot: opts.worktreeConfigSnapshot,
  });
  if (!block) return cleanPrompt;

  const label = opts.label || 'Use these repo standards for the delegated work.';
  return [cleanPrompt, '', label, block].join('\n');
}

export function applyAgentDevelopmentStandardsToPrompts(
  prompts: string[],
  opts: ApplyAgentDevelopmentStandardsOptions = {},
): string[] {
  return prompts.map((prompt) => applyAgentDevelopmentStandardsToPrompt(prompt, opts));
}
