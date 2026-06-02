import type { ChatCommandRouteId } from './chatCommandRegistry';

export type UserTaskPipelineCategory =
  | 'answer'
  | 'knowledge'
  | 'browser'
  | 'desktop'
  | 'automation'
  | 'code'
  | 'creative'
  | 'business'
  | 'workspace'
  | 'security';

export type UserTaskPipelineRisk =
  | 'safe'
  | 'review'
  | 'external_side_effect'
  | 'destructive';

export type UserTaskPipelineExecutionKind =
  | 'run_plain_chat'
  | 'run_command_handler'
  | 'run_openswan'
  | 'run_computer_task'
  | 'run_build_discovery'
  | 'run_browser_plan';

export type UserTaskPipelineId =
  | 'direct_answer'
  | 'capability_explanation'
  | 'live_research'
  | 'knowledge_search'
  | 'memory_second_brain'
  | 'browser_data_retrieval'
  | 'browser_form_submission'
  | 'browser_navigation'
  | 'desktop_awareness'
  | 'bridge_troubleshooting'
  | 'desktop_app_control'
  | 'local_files'
  | 'terminal_agents'
  | 'vault_credentials'
  | 'wordpress_cms'
  | 'website_platform_admin'
  | 'coding_build'
  | 'debug_fix'
  | 'code_review'
  | 'security_privacy'
  | 'performance_cost'
  | 'creative_image_design'
  | 'creative_layout_design'
  | 'adobe_creative_cloud'
  | 'content_generation'
  | 'customer_support_crm'
  | 'sales_leads_outreach'
  | 'analytics_reporting'
  | 'meetings_calendar_email'
  | 'data_import_export'
  | 'finance_billing'
  | 'document_intelligence'
  | 'qa_testing'
  | 'it_support_ops'
  | 'compliance_monitoring'
  | 'hr_onboarding'
  | 'marketing_campaigns'
  | 'workflow_recording_replay'
  | 'travel_booking'
  | 'procurement_shopping'
  | 'cloud_devops'
  | 'social_community'
  | 'inbox_notifications'
  | 'learning_training'
  | 'high_stakes_advice'
  | 'tasks_missions'
  | 'office_agents'
  | 'integrations_models'
  | 'schedule_automation'
  | 'governance_approvals'
  | 'human_verification';

export interface UserTaskPipelineDefinition {
  id: UserTaskPipelineId;
  title: string;
  category: UserTaskPipelineCategory;
  description: string;
  matchers: RegExp[];
  negativeMatchers?: RegExp[];
  routeId: ChatCommandRouteId | null;
  executionKind: UserTaskPipelineExecutionKind;
  risk: UserTaskPipelineRisk;
  defaultCommand?: string;
  preferredSurfaces: string[];
  recommendedTools: string[];
  executionRequirements?: string[];
  solutionSteps: string[];
  completionCriteria: string[];
  approvalTriggers: string[];
  persistenceTargets: string[];
  exampleQuestions: string[];
}

export interface UserTaskPipelineMatch {
  pipeline: UserTaskPipelineDefinition;
  score: number;
  confidence: number;
  reasons: string[];
}

export interface UserTaskPipelineSummary {
  id: UserTaskPipelineId;
  title: string;
  category: UserTaskPipelineCategory;
  routeId: ChatCommandRouteId | null;
  executionKind: UserTaskPipelineExecutionKind;
  risk: UserTaskPipelineRisk;
  confidence: number;
  recommendedTools: string[];
  executionRequirements: string[];
  solutionSteps: string[];
  completionCriteria: string[];
  approvalTriggers: string[];
  persistenceTargets: string[];
}

export type UserTaskPipelineExecutionPattern =
  | 'direct'
  | 'sequential'
  | 'parallel'
  | 'human_review';

export interface UserTaskPipelineDecision {
  primary: UserTaskPipelineSummary;
  supporting: UserTaskPipelineSummary[];
  pattern: UserTaskPipelineExecutionPattern;
  aggregateRisk: UserTaskPipelineRisk;
  confidence: number;
  needsClarification: boolean;
  clarificationReason: string | null;
  orchestrationSteps: string[];
  executionRequirements: string[];
  approvalTriggers: string[];
  persistenceTargets: string[];
}

const URL_RE = /\bhttps?:\/\/\S+|\bwww\.[^\s]+/i;
const FILE_PATH_RE = /(?:^|\s)(?:~\/|\/|\.\/|\.\.\/)[^\s]+/i;
const STACK_TRACE_RE = /\b(error|exception|stack trace|traceback|typeerror|referenceerror|syntaxerror|failed to load|400|401|403|404|409|500)\b/i;
const CODE_RE = /```|<\/?[A-Za-z][^>]*>|\b(function|const|let|class|interface|type|import|export)\b/i;
const ADOBE_CC_APP_RE = /\b(?:adobe\s+(?:illustrator|premiere(?:\s+pro)?|after\s+effects|acrobat(?:\s+(?:pro|reader))?|lightroom(?:\s+classic)?|audition|animate|media\s+encoder|bridge|dreamweaver|incopy|character\s+animator|express|firefly|fresco|capture|scan|fill\s*(?:&|and)?\s*sign|photoshop\s+express|substance\s+3d)|illustrator|premiere(?:\s+pro)?|after\s+effects|acrobat(?:\s+(?:pro|reader))?|lightroom(?:\s+classic)?|audition|media\s+encoder|dreamweaver|incopy|character\s+animator|firefly|fresco|fill\s*(?:&|and)\s*sign|photoshop\s+express|substance\s+3d|substance\s+(?:painter|designer|sampler|stager)|frame\.?io)\b/i;
const ADOBE_CC_FILE_RE = /\b\.(?:ai|ait|eps|prproj|prfpset|aepx?|mogrt|lrcat|dng|xmp|sesx|fla|xfl|chproj|puppet|epr|spp|sbs|sbsar)\b/i;
const ADOBE_CORE_SCRIPTED_RE = /\b(indesign|in\s*design|photoshop|photo\s*shop|psd|psb|indd|idml|indt)\b|\.indd\b|\.idml\b|\.indt\b|\.psd\b|\.psb\b/i;

export const USER_TASK_PIPELINES: UserTaskPipelineDefinition[] = [
  {
    id: 'direct_answer',
    title: 'Direct Answer',
    category: 'answer',
    description: 'Answer a normal question without unnecessary tool use.',
    matchers: [/\b(what is|who is|why|how does|explain|define|meaning of)\b/i],
    negativeMatchers: [/\b(latest|today|current|research|browse|look up|open|click|run|fix|build|create task)\b/i],
    routeId: null,
    executionKind: 'run_plain_chat',
    risk: 'safe',
    preferredSurfaces: ['chat'],
    recommendedTools: ['chat_history', 'memory_if_relevant'],
    solutionSteps: [
      'Answer the question directly.',
      'Use memory only when it changes the answer.',
      'Offer an action path if the answer implies a task.',
    ],
    completionCriteria: ['The user gets a clear answer and a next step when useful.'],
    approvalTriggers: [],
    persistenceTargets: ['chat_message'],
    exampleQuestions: ['What is OpenSwan?', 'How does prompt caching work?'],
  },
  {
    id: 'capability_explanation',
    title: 'Capability Explanation',
    category: 'answer',
    description: 'Explain what the app, model, agent, or connected bridge can actually do.',
    matchers: [
      /\b(can you|are you able|how good are you|what can you do|do you support)\b/i,
      /\b(photoshop|figma|canva|browser|desktop|computer|models?|agent|openswan|swanbot)\b/i,
    ],
    routeId: null,
    executionKind: 'run_plain_chat',
    risk: 'safe',
    preferredSurfaces: ['chat', 'control_panel'],
    recommendedTools: ['integrations.list', 'desktop.health', 'browser.health'],
    solutionSteps: [
      'Answer as The Underground Circle runtime, not the upstream model provider.',
      'Separate immediate guidance from bridge-backed hands-on control.',
      'State requirements, limits, and the safest next action.',
    ],
    completionCriteria: ['The user understands what is possible now, what requires setup, and what to ask next.'],
    approvalTriggers: ['Any transition from explanation into desktop/browser action.'],
    persistenceTargets: ['chat_message'],
    exampleQuestions: ['How good are you at Photoshop?', 'Can you see my Chrome tabs?', 'Can you run apps on my Mac?'],
  },
  {
    id: 'live_research',
    title: 'Live Research',
    category: 'knowledge',
    description: 'Research current or uncertain information, compare options, and cite sources.',
    matchers: [/\b(research|deep research|look up|browse|latest|current|today|compare|best practices?|sources?|citations?)\b/i],
    routeId: 'local_knowledge',
    executionKind: 'run_openswan',
    risk: 'safe',
    preferredSurfaces: ['research_corpus', 'web_search', 'wiki'],
    recommendedTools: ['research.search', 'fetch_url', 'save_memory'],
    solutionSteps: [
      'Check internal wiki/research first for reusable app knowledge.',
      'Browse official or primary sources for current facts.',
      'Separate findings, tradeoffs, recommendation, and implementation impact.',
      'Save durable findings when they should improve future runs.',
    ],
    completionCriteria: ['Findings include source-backed conclusions and an implementation recommendation.'],
    approvalTriggers: [],
    persistenceTargets: ['research_memory', 'digital_brain', 'chat_message'],
    exampleQuestions: ['Do deep research on browser automation prompts.', 'What are the latest agent routing best practices?'],
  },
  {
    id: 'knowledge_search',
    title: 'Wiki And Knowledge Search',
    category: 'knowledge',
    description: 'Search the internal wiki, research corpus, digital brain, memories, and app documentation.',
    matchers: [/\b(wiki|knowledge base|research corpus|docs|documentation|digital brain|second brain|what do we know)\b/i],
    routeId: 'local_knowledge',
    executionKind: 'run_command_handler',
    risk: 'safe',
    defaultCommand: '/wiki ',
    preferredSurfaces: ['wiki', 'research_corpus', 'second_brain'],
    recommendedTools: ['research.search', 'search_memories'],
    solutionSteps: [
      'Search local knowledge before external web.',
      'Summarize matching notes and link back to source records when available.',
      'Recommend creating or updating a knowledge entry when the answer exposes a gap.',
    ],
    completionCriteria: ['The answer cites relevant internal knowledge or states that no matching internal knowledge exists.'],
    approvalTriggers: [],
    persistenceTargets: ['chat_message', 'search_trace'],
    exampleQuestions: ['Search the wiki for Browserbase.', 'What do we know about second brain design?'],
  },
  {
    id: 'memory_second_brain',
    title: 'Memory And Digital Brain',
    category: 'knowledge',
    description: 'Save, recall, cluster, connect, or visualize memory and second-brain knowledge.',
    matchers: [/\b(remember|save this|memory|memories|forget|recall|second brain|digital brain|clusters?|graph view|obsidian|mind map)\b/i],
    routeId: 'memory',
    executionKind: 'run_command_handler',
    risk: 'safe',
    defaultCommand: '/memories',
    preferredSurfaces: ['memory_store', 'digital_brain', 'backpack'],
    recommendedTools: ['search_memories', 'save_memory', 'research.save'],
    solutionSteps: [
      'Classify whether the user wants to save, retrieve, delete, connect, or visualize knowledge.',
      'Use user-scoped memory for personal facts and circle memory for shared work.',
      'Update graph/cluster metadata when the memory has durable relationships.',
    ],
    completionCriteria: ['The requested memory operation is completed or the relevant memory set is shown.'],
    approvalTriggers: ['Deletion or forgetting user/circle memory.'],
    persistenceTargets: ['user_memory', 'circle_memory', 'digital_brain'],
    exampleQuestions: ['Remember that I prefer Codex for code.', 'Show my agent memories.', 'Map this into my digital brain.'],
  },
  {
    id: 'browser_data_retrieval',
    title: 'Browser Data Retrieval',
    category: 'browser',
    description: 'Open pages and extract structured data from dynamic websites.',
    matchers: [
      /\b(extract|scrape|crawl|collect|gather|pull|export)\b.*\b(data|table|records?|products?|prices?|listings?|json|csv|fields?)\b/i,
      /\b(web data retrieval|structured data|data from)\b/i,
      URL_RE,
    ],
    routeId: 'browser',
    executionKind: 'run_computer_task',
    risk: 'safe',
    preferredSurfaces: ['browserbase_stagehand', 'browser_bridge', 'playwright'],
    recommendedTools: ['browser.open_url', 'browser.dom_snapshot', 'browser.screenshot', 'fetch_url'],
    solutionSteps: [
      'Open the source page and wait for rendered content.',
      'Use DOM/ARIA extraction first; use Stagehand extract for dynamic or ambiguous pages.',
      'Return narrow structured output with source URLs.',
      'Stop when requested records are captured or a blocker is identified.',
    ],
    completionCriteria: ['Structured data is returned with source context and any skipped/capped records disclosed.'],
    approvalTriggers: ['Logged-in pages, high-volume crawling, paywalled data, or export actions.'],
    persistenceTargets: ['chat_message', 'artifact', 'browser_plan'],
    exampleQuestions: ['Extract product prices from this site.', 'Pull the table into JSON.', 'Collect listings from this URL.'],
  },
  {
    id: 'browser_form_submission',
    title: 'Browser Form Submission',
    category: 'browser',
    description: 'Fill forms, login flows, admin panels, checkout-like workflows, and multi-step web tasks.',
    matchers: [/\b(fill|complete|submit|populate|apply|register|checkout)\b.*\b(form|survey|application|registration|checkout|fields?)\b/i, /\b(log ?in|sign ?in|admin panel|dashboard)\b/i],
    routeId: 'browser',
    executionKind: 'run_computer_task',
    risk: 'review',
    preferredSurfaces: ['browser_bridge', 'browserbase_computer_use', 'vault'],
    recommendedTools: ['browser.verification_state', 'browser.dom_snapshot', 'browser.fill_field', 'browser.fill_credential_field', 'approvals.request'],
    solutionSteps: [
      'Identify required fields and whether login or saved credentials are needed.',
      'Check for CAPTCHA, MFA, or human verification before clicking/filling.',
      'Fill non-sensitive fields deterministically.',
      'Ask before final submit, payment, publish, delete, or external send.',
      'Verify success through confirmation text, URL, or submitted-state proof.',
    ],
    completionCriteria: ['Form state is filled or submitted with explicit confirmation/proof.'],
    approvalTriggers: ['Credential use, final submission, payment, publish, delete, application, or external send.'],
    persistenceTargets: ['browser_plan', 'approval', 'chat_message'],
    exampleQuestions: ['Fill out this form for me.', 'Login to WordPress and draft a post.', 'Submit this application.'],
  },
  {
    id: 'browser_navigation',
    title: 'Browser Navigation And Inspection',
    category: 'browser',
    description: 'Open sites, inspect pages, click around, screenshot, summarize pages, and monitor browser state.',
    matchers: [/\b(open|visit|go to|navigate|browse|inspect|click|screenshot|capture|monitor)\b.*\b(site|website|page|url|browser|tab)\b/i, /\bbrowser\b/i],
    routeId: 'browser',
    executionKind: 'run_browser_plan',
    risk: 'review',
    preferredSurfaces: ['browser_bridge', 'browserbase'],
    recommendedTools: ['browser.open_url', 'browser.dom_snapshot', 'browser.click_role', 'browser.screenshot'],
    solutionSteps: [
      'Resolve the target URL or page state.',
      'Use semantic selectors before screenshots and coordinates.',
      'Verify each visible state change before continuing.',
      'Report blockers instead of looping.',
    ],
    completionCriteria: ['The requested page state is reached, captured, summarized, or blocked with a clear reason.'],
    approvalTriggers: ['Any write, submit, login, checkout, or destructive browser action.'],
    persistenceTargets: ['browser_plan', 'chat_message'],
    exampleQuestions: ['Open this URL and tell me what it says.', 'Screenshot the page.', 'Click the pricing tab.'],
  },
  {
    id: 'desktop_awareness',
    title: 'Local Desktop Awareness',
    category: 'desktop',
    description: 'Read local browser tabs, active window, screen state, clipboard, running apps, local files, and shortcuts.',
    matchers: [/\b(what|which|show|list|tell me|see|view)\b.*\b(tabs?|open apps?|running apps?|screen|window|clipboard|files?|shortcuts?)\b/i, /\b(my computer|my mac|local desktop|chrome tabs|safari tabs)\b/i],
    routeId: null,
    executionKind: 'run_openswan',
    risk: 'safe',
    preferredSurfaces: ['desktop_bridge'],
    recommendedTools: ['desktop.list_browser_tabs', 'desktop.window_state', 'desktop.list_running_apps', 'desktop.clipboard', 'desktop.file_list'],
    solutionSteps: [
      'Use the local desktop bridge, not the remote Browserbase session.',
      'Read only the requested local state.',
      'Return titles, URLs, app names, file names, or clipboard summaries without changing state.',
    ],
    completionCriteria: ['The user receives the requested local state or a bridge-readiness blocker.'],
    approvalTriggers: [],
    persistenceTargets: ['chat_message', 'desktop_trace'],
    exampleQuestions: ['Tell me all the tabs I have open in Chrome.', 'What app is active?', 'What is on my clipboard?'],
  },
  {
    id: 'bridge_troubleshooting',
    title: 'Desktop And Browser Bridge Troubleshooting',
    category: 'desktop',
    description: 'Diagnose local desktop/browser bridge failures, missing endpoints, CORS/token issues, permissions, and remote-vs-local browser confusion.',
    matchers: [
      /\b(bridge|desktop bridge|browser bridge|local bridge|desktop\/browser_tabs|browser_tabs|x-uc-desktop-token|cors|preflight|unknown \/desktop endpoint)\b/i,
      /\b(can'?t|cannot|unable|not able|blocked|404|not found|offline|not connected)\b.*\b(tabs?|chrome|safari|browser|desktop|computer|bridge)\b/i,
      /\b(browserbase|remote browser|sandboxed browser)\b.*\b(local|my chrome|my browser|tabs?)\b/i,
    ],
    routeId: null,
    executionKind: 'run_openswan',
    risk: 'safe',
    preferredSurfaces: ['desktop_bridge', 'browser_bridge', 'control_panel', 'diagnostics'],
    recommendedTools: ['desktop.list_browser_tabs', 'desktop.window_state', 'desktop.list_running_apps', 'integrations.list'],
    solutionSteps: [
      'Separate local desktop bridge access from remote Browserbase/browser sessions.',
      'Run the smallest health probe for the requested surface before answering capability questions.',
      'Identify the failing endpoint, CORS/header, token, permission, or bridge-version mismatch.',
      'Return the exact blocker and recovery action instead of answering as the upstream model provider.',
    ],
    completionCriteria: ['The user gets either the requested local state or an exact bridge readiness blocker with next recovery step.'],
    approvalTriggers: [],
    persistenceTargets: ['chat_message', 'desktop_trace', 'integration_health'],
    exampleQuestions: ['Why can you not see my Chrome tabs?', 'The desktop/browser_tabs endpoint returns 404.', 'CORS blocked x-uc-desktop-token on the local bridge.'],
  },
  {
    id: 'desktop_app_control',
    title: 'Local Desktop App Control',
    category: 'desktop',
    description: 'Launch, focus, click, type, fill fields, drag, scroll, resize, or automate native desktop apps.',
    matchers: [/\b(open|launch|focus|switch to|click|type|fill|set|enter|press|drag|scroll|resize|minimize|run shortcut)\b/i, /\b(photoshop|figma|slack|notion|finder|terminal|vscode|cursor|excel|word|mail|calendar|desktop app|native app)\b/i],
    negativeMatchers: [/\b(signup|registration|application|checkout|survey|web|website|browser)\b.*\b(forms?|fields?|submit|apply|register|checkout)\b/i],
    routeId: null,
    executionKind: 'run_openswan',
    risk: 'review',
    preferredSurfaces: ['desktop_bridge', 'accessibility_tree', 'screenshot'],
    recommendedTools: ['desktop.launch_app', 'desktop.focus_app', 'desktop.read_a11y_tree', 'desktop.set_element_value', 'desktop.screenshot', 'desktop.click_element'],
    solutionSteps: [
      'Confirm the target app and desired state.',
      'Prefer accessibility tree and semantic UI elements.',
      'Use screenshots and coordinates only for canvas apps or missing accessibility nodes.',
      'Verify the visible result after each major action.',
    ],
    completionCriteria: ['The desktop app reaches the requested state or reports the exact missing permission/capability.'],
    approvalTriggers: ['Typing text, clicking, deleting, sending, publishing, file writes, or shortcut execution.'],
    persistenceTargets: ['desktop_trace', 'approval', 'chat_message'],
    exampleQuestions: ['Open Photoshop and crop this image.', 'Focus Slack and send a message.', 'Click at 400, 300.'],
  },
  {
    id: 'local_files',
    title: 'Local File Work',
    category: 'desktop',
    description: 'List, inspect metadata, read, search, open, summarize, rename, move, copy, create, write, upload, download, export, import, or trash local files and folders.',
    matchers: [/\b(list|read|open|search|find|locate|summarize|inspect|metadata|info|size|exists?|rename|change|move|copy|duplicate|create|make|write|save|append|upload|attach|download|export|import|delete|remove|trash)\b.*\b(file|folder|directory|downloads|documents|desktop|image|photo|pdf|csv|spreadsheet|sheet|notes?)\b/i, FILE_PATH_RE],
    routeId: null,
    executionKind: 'run_openswan',
    risk: 'safe',
    preferredSurfaces: ['desktop_bridge', 'file_tools'],
    recommendedTools: ['desktop.file_list', 'desktop.file_stat', 'desktop.file_read', 'desktop.file_search', 'desktop.file_rename', 'desktop.file_write_text', 'desktop.file_copy', 'desktop.file_trash', 'desktop.file_mkdir', 'desktop.open_path'],
    solutionSteps: [
      'Resolve the path or search root.',
      'Read only the files needed for the request.',
      'Summarize or act on content without exposing unrelated files.',
      'For explicit write requests, request write-scoped verification, execute the smallest exact mutation, then report the exact affected paths.',
    ],
    completionCriteria: ['Requested file information is returned or a permission/path blocker is reported.'],
    approvalTriggers: ['Opening external apps, writing files, deleting files, or moving files.'],
    persistenceTargets: ['chat_message', 'desktop_trace'],
    exampleQuestions: ['List files in ~/Downloads.', 'Read this PDF.', 'Search my Desktop for invoices.', 'Upload a Desktop image to Shopify.'],
  },
  {
    id: 'terminal_agents',
    title: 'Terminal Agent Orchestration',
    category: 'automation',
    description: 'Start, monitor, message, and coordinate Codex, Claude Code, Gemini CLI, Cursor, or other terminal agents.',
    matchers: [/\b(start|launch|spawn|open|run|manage|message|send prompt to|monitor)\b.*\b(codex|claude code|gemini cli|cursor|terminal agents?|sessions?)\b/i, /\b(separate|parallel|multi[- ]agent|agents?)\b.*\b(terminal|session|codex|claude)\b/i],
    routeId: null,
    executionKind: 'run_openswan',
    risk: 'review',
    preferredSurfaces: ['terminal_bridge', 'office_dashboard', 'agent_runs'],
    recommendedTools: ['office.list_agents', 'messages.create', 'approvals.request'],
    solutionSteps: [
      'Parse provider, session count, working directory, and prompts.',
      'Launch sessions through the matching local bridge.',
      'Stream status and output into chat and Office dashboard.',
      'Allow follow-up messages to target one, some, or all sessions.',
    ],
    completionCriteria: ['Sessions are launched or the bridge/CLI blocker is explicit; management state is visible in Office.'],
    approvalTriggers: ['Launching terminals, executing shell commands, writing files, or sending prompts to agents.'],
    persistenceTargets: ['agent_runs', 'office_roster', 'chat_message', 'user_memory'],
    exampleQuestions: ['Start 10 separate Codex sessions in my terminal.', 'Send this prompt to every Claude Code session.'],
  },
  {
    id: 'vault_credentials',
    title: 'Vault Credentials',
    category: 'security',
    description: 'Save, find, grant, revoke, rotate, or safely use credentials for automation.',
    matchers: [/\b(vault|credential|credentials|password|username|login info|saved login|secret|api key|grant access|revoke access|rotate)\b/i],
    routeId: 'vault',
    executionKind: 'run_command_handler',
    risk: 'review',
    defaultCommand: '/vault status',
    preferredSurfaces: ['vault', 'approvals', 'browser_bridge'],
    recommendedTools: ['vault.find', 'vault.grants', 'vault.grant', 'vault.runbook', 'browser.fill_credential_field'],
    solutionSteps: [
      'Classify whether the request is create, search, grant, revoke, rotate, or use.',
      'Never print raw secrets in model-visible output.',
      'Use scoped grants and origin checks before browser login automation.',
      'Log access and require approval for credential use.',
    ],
    completionCriteria: ['Credential state is updated or a safe runbook/grant path is returned.'],
    approvalTriggers: ['Viewing, using, granting, rotating, or deleting credentials.'],
    persistenceTargets: ['vault', 'audit_log', 'approval'],
    exampleQuestions: ['Find my WordPress login.', 'Grant OpenSwan access to this credential.', 'Rotate this password.'],
  },
  {
    id: 'wordpress_cms',
    title: 'WordPress And CMS',
    category: 'business',
    description: 'Draft, edit, schedule, publish, list, or manage WordPress/CMS content.',
    matchers: [/\b(wordpress|wp admin|cms|blog|post|page|featured image|categories|tags|draft|publish|schedule)\b/i],
    routeId: 'wordpress',
    executionKind: 'run_command_handler',
    risk: 'external_side_effect',
    defaultCommand: '/wp status',
    preferredSurfaces: ['wordpress_api', 'browser_bridge', 'vault'],
    recommendedTools: ['wp.list_posts', 'wp.create_slide', 'browser.open_url', 'vault.resolve_for_task', 'approvals.request'],
    solutionSteps: [
      'Resolve site connection and content target.',
      'Use API tools when possible; use browser automation for admin-only flows.',
      'Draft before publish unless the user explicitly asks to go live.',
      'Verify public URL or admin status after action.',
    ],
    completionCriteria: ['CMS content is drafted, updated, scheduled, listed, or published with proof.'],
    approvalTriggers: ['Publish, delete, schedule, credential use, or public site changes.'],
    persistenceTargets: ['cms_trace', 'approval', 'chat_message'],
    exampleQuestions: ['Draft a WordPress post.', 'Edit this page.', 'Schedule the blog for tomorrow.'],
  },
  {
    id: 'website_platform_admin',
    title: 'Website Platform Admin',
    category: 'business',
    description: 'Automate authenticated website builders, ecommerce admins, and CMS dashboards beyond WordPress.',
    matchers: [
      /\b(shopify|webflow|wix|squarespace|woocommerce|bigcommerce|framer|godaddy|site builder|website builder|ecommerce admin|store admin)\b/i,
      /\b(log ?in|sign ?in|edit|update|publish|draft|change|add|remove|upload|configure)\b.*\b(product|collection|landing page|homepage|site|store|theme|blog|cms|website)\b/i,
      /\b(admin|dashboard)\b.*\b(shopify|webflow|wix|squarespace|woocommerce|bigcommerce|framer|website|store)\b/i,
    ],
    routeId: 'browser',
    executionKind: 'run_computer_task',
    risk: 'external_side_effect',
    preferredSurfaces: ['browser_bridge', 'browserbase_stagehand', 'vault', 'marketplace_integrations', 'approvals'],
    recommendedTools: ['vault.resolve_for_task', 'browser.open_url', 'browser.verification_state', 'browser.dom_snapshot', 'browser.fill_field', 'browser.click_role', 'approvals.request'],
    solutionSteps: [
      'Resolve platform, site/account, admin URL, target object, and desired final state.',
      'Use a marketplace/API integration when connected; otherwise use browser automation with semantic DOM actions.',
      'Resolve credentials through a scoped vault grant and verify the allowed origin before login.',
      'Work in draft, preview, or staged state when the platform supports it.',
      'Require approval before publishing, charging, deleting, changing live inventory, or sending external notifications.',
      'Capture proof through admin status, public URL, screenshot, or confirmation text.',
    ],
    completionCriteria: ['The website/admin change is completed, staged for approval, or blocked with an exact login/platform/verification reason.'],
    approvalTriggers: ['Credential use, publish, delete, payment, inventory changes, theme changes, or public site changes.'],
    persistenceTargets: ['browser_plan', 'cms_trace', 'approval', 'chat_message', 'vault_audit_log'],
    exampleQuestions: ['Log into Shopify and update this product page.', 'Use Webflow to edit the landing page headline.', 'Update the Squarespace homepage after I approve.'],
  },
  {
    id: 'coding_build',
    title: 'Code Build And Implementation',
    category: 'code',
    description: 'Build features, components, pages, APIs, SQL, scripts, migrations, or app logic.',
    matchers: [/\b(build|implement|create|add|make|generate|write|ship)\b.*\b(feature|component|page|api|endpoint|sql|migration|script|code|dashboard|screen|function|implementation plan|plan)\b/i, CODE_RE],
    routeId: 'build_page',
    executionKind: 'run_openswan',
    risk: 'safe',
    preferredSurfaces: ['workspace', 'rooms', 'code_tools'],
    recommendedTools: ['code.inspect', 'code.generate', 'verification.typecheck', 'verification.tests', 'workspace.apply_artifacts'],
    solutionSteps: [
      'Inspect nearby code and existing patterns.',
      'Make the smallest coherent implementation.',
      'Run typecheck/tests or provide exact verification blockers.',
      'Persist artifacts, run metadata, and follow-up tasks when needed.',
    ],
    completionCriteria: ['The implementation exists, compiles where possible, and has verification notes.'],
    approvalTriggers: ['External deploy, destructive migration, production data changes, or irreversible file operations.'],
    persistenceTargets: ['agent_runs', 'room_artifacts', 'chat_message'],
    exampleQuestions: ['Build the implementation plan.', 'Add SQL for this feature.', 'Create the new dashboard section.'],
  },
  {
    id: 'debug_fix',
    title: 'Debug And Fix',
    category: 'code',
    description: 'Diagnose errors, root-cause broken behavior, and patch regressions.',
    matchers: [STACK_TRACE_RE, /\b(debug|fix|broken|not working|bug|crash|regression|console error|failed)\b/i],
    routeId: null,
    executionKind: 'run_openswan',
    risk: 'safe',
    preferredSurfaces: ['code_tools', 'verification', 'browser_console'],
    recommendedTools: ['code.inspect', 'code.generate', 'verification.typecheck', 'verification.tests'],
    solutionSteps: [
      'Identify the failing subsystem and likely root cause.',
      'Patch the narrowest source of failure.',
      'Run a regression check.',
      'Explain the fix and remaining risk.',
    ],
    completionCriteria: ['The error is fixed or root cause/blocker is explicit with next verification step.'],
    approvalTriggers: ['Production database writes or destructive cleanup.'],
    persistenceTargets: ['agent_runs', 'chat_message', 'memory_if_recurring'],
    exampleQuestions: ['Fix this 400 error.', 'Why did React throw Expected static flag?', 'Debug bridge CORS.'],
  },
  {
    id: 'code_review',
    title: 'Review And Audit',
    category: 'code',
    description: 'Review recent changes, code quality, architecture, tests, security, and release readiness.',
    matchers: [/\b(review|audit|inspect|quality check|release ready|go live|best possible|optimize)\b/i],
    routeId: null,
    executionKind: 'run_openswan',
    risk: 'safe',
    preferredSurfaces: ['code_tools', 'verification', 'agent_runs'],
    recommendedTools: ['code.review', 'verification.typecheck', 'verification.tests', 'verification.lint'],
    solutionSteps: [
      'Inspect changed files and the behavior they affect.',
      'Rank findings by severity.',
      'Check missing tests, regressions, security, and performance.',
      'Patch obvious safe issues or produce a release checklist.',
    ],
    completionCriteria: ['Findings are severity-ranked or no findings are stated with residual risks.'],
    approvalTriggers: ['Applying broad refactors or destructive changes.'],
    persistenceTargets: ['agent_runs', 'review_notes', 'chat_message'],
    exampleQuestions: ['Review all recent changes.', 'Make sure this is built best possible.', 'Audit the dashboard.'],
  },
  {
    id: 'security_privacy',
    title: 'Security And Privacy',
    category: 'security',
    description: 'Check vulnerabilities, API key isolation, auth, RLS, secrets, vault safety, and user data boundaries.',
    matchers: [/\b(security|vulnerab|privacy|api keys?|secret|auth|rls|supabase policy|xss|csrf|injection|leak|exposed)\b/i],
    routeId: null,
    executionKind: 'run_openswan',
    risk: 'review',
    preferredSurfaces: ['code_tools', 'supabase', 'vault', 'integrations'],
    recommendedTools: ['code.review', 'integrations.list', 'verification.tests', 'approvals.request'],
    solutionSteps: [
      'Map trust boundaries and stored secrets.',
      'Check client/server separation, RLS, and API-key usage.',
      'Patch direct leaks and document any required migration.',
      'Add verification or smoke coverage for the boundary.',
    ],
    completionCriteria: ['Security risks are fixed or listed with concrete remediation and verification.'],
    approvalTriggers: ['Key rotation, policy migration, credential access, or auth changes.'],
    persistenceTargets: ['agent_runs', 'security_notes', 'chat_message'],
    exampleQuestions: ['Make sure my APIs are not used by other users.', 'Clean up vulnerabilities.', 'Check Supabase auth policies.'],
  },
  {
    id: 'performance_cost',
    title: 'Performance And Cost',
    category: 'business',
    description: 'Reduce load time, API spend, token usage, cron cost, model-routing cost, and bridge overhead.',
    matchers: [/\b(slow|loading slow|performance|latency|bundle|cost|charges?|api usage|tokens?|cron|optimize|expensive)\b/i],
    routeId: null,
    executionKind: 'run_openswan',
    risk: 'safe',
    preferredSurfaces: ['analytics', 'cost_ledger', 'code_tools', 'office_dashboard'],
    recommendedTools: ['code.inspect', 'verification.typecheck', 'integrations.list', 'office.list_agents'],
    solutionSteps: [
      'Identify whether the issue is frontend load, backend calls, model usage, cron, or bridge polling.',
      'Measure or inspect the highest-cost path first.',
      'Apply caching, focused routing, lazy loading, or model fallback changes.',
      'Report expected savings and remaining unknowns.',
    ],
    completionCriteria: ['A cost/performance hotspot is reduced or a measurable audit path is produced.'],
    approvalTriggers: ['Disabling jobs, changing provider keys, or production billing settings.'],
    persistenceTargets: ['cost_audit', 'agent_runs', 'chat_message'],
    exampleQuestions: ['Why am I getting $10 charges daily?', 'The app is loading slow.', 'Optimize computer use cost.'],
  },
  {
    id: 'creative_layout_design',
    title: 'Creative Layout App Automation',
    category: 'creative',
    description: 'Automate layered InDesign/layout documents such as marketing banners, print ads, dealer offers, flyers, brochures, and production proofs.',
    matchers: [
      /\b(indesign|in\s*design|\.indd\b|\.idml\b|\.indt\b|idml|indd|text frames?|preflight|package links?|data merge)\b/i,
      /\b(marketing|campaign|dealer|display|social|print|web|email)?\s*(banner|ad\b|advert|flyer|brochure|poster|layout|spread|page|template)\b.*\b(layers?|headline|cta|disclaimer|legal|offer|price|apr|logo|links?|asset|copy|export|proof|firefly|generative|text[-\s]?to[-\s]?image|variants?)\b/i,
      /\b(change|update|replace|edit|resize|export|package|proof)\b.*\b(indesign|layout|banner|layers?|text frames?|links?|placed assets?)\b/i,
      /\b(indesign|in\s*design|layout|banner)\b.*\b(firefly|generative expand|text[-\s]?to[-\s]?image|generate (?:an? )?(?:image|background|asset)|data merge|personalized|localized|variants?)\b/i,
    ],
    routeId: null,
    executionKind: 'run_computer_task',
    risk: 'review',
    preferredSurfaces: ['desktop_bridge', 'indesign_script_tools', 'staged_file_package', 'approvals'],
    recommendedTools: ['desktop.file_search', 'desktop.file_stat', 'desktop.open_path', 'desktop.indesign_document_status', 'desktop.indesign_text_inventory', 'desktop.indesign_set_layer_state', 'desktop.indesign_batch_update_text_layers', 'desktop.indesign_package_document', 'desktop.indesign_relink_asset', 'desktop.indesign_export_proof', 'desktop.indesign_batch_find_change', 'desktop.indesign_update_text_layer', 'research.search', 'agent.build_app_capability', 'desktop.screenshot', 'approvals.request'],
    solutionSteps: [
      'Resolve the exact InDesign document or staged package folder before opening or editing.',
      'Use InDesign script-backed document status and text inventory to map layers, text frames, links, fonts, overset text, and locked/hidden layers.',
      'Apply copy changes with named text-layer updates or exact find/change before falling back to accessibility/menu actions.',
      'Gate file mutation, relinking, save, export, package, and script buildout behind approval.',
      'For Firefly/text-to-image/generative expand/data-merge variants, require prompt or data-source approval plus generated output receipts before placement or proof.',
      'Verify with a refreshed inventory, document status, screenshot, and exported proof/file stat when requested.',
    ],
    completionCriteria: ['The layout edit is applied and verified, staged for approval, or blocked with an exact document/layer/font/link/permission reason.'],
    approvalTriggers: ['Editing the InDesign document, relinking assets, unlocking/showing layers, AI image generation, generative expand, data-merge variants, saving over source files, exporting/package handoff, or running new scripts.'],
    persistenceTargets: ['computer_task_state', 'desktop_attachment_manifest', 'run_ledger', 'proof_artifact', 'chat_message'],
    exampleQuestions: ['Open this InDesign banner and update the headline and disclaimer layers.', 'Replace the image in this dealer ad and export a proof PDF.', 'Make changes in InDesign for a marketing banner with different layers.'],
  },
  {
    id: 'adobe_creative_cloud',
    title: 'Adobe Creative Cloud App Automation',
    category: 'creative',
    description: 'Route Illustrator, Premiere Pro, After Effects, Acrobat, Lightroom, Audition, Animate, Bridge, Media Encoder, Dreamweaver, InCopy, Express, Firefly, Fresco, Substance 3D, and adjacent Adobe CC product tasks through app-profile-aware desktop automation.',
    matchers: [
      ADOBE_CC_APP_RE,
      ADOBE_CC_FILE_RE,
      /\badobe\s+creative\s+cloud\b.*\b(app|desktop|automation|edit|export|render|proof|document|file|project)\b/i,
      /\b(open|launch|focus|edit|change|update|create|make|export|render|encode|transcode|animate|vector|proof|package)\b.*\b(adobe|creative\s+cloud)\b/i,
    ],
    negativeMatchers: [ADOBE_CORE_SCRIPTED_RE],
    routeId: null,
    executionKind: 'run_computer_task',
    risk: 'review',
    preferredSurfaces: ['desktop_bridge', 'adobe_app_profiles', 'staged_file_package', 'connected_agent_buildout', 'approvals'],
    recommendedTools: ['desktop.file_search', 'desktop.file_stat', 'desktop.open_path', 'desktop.launch_app', 'desktop.focus_app', 'desktop.window_state', 'desktop.read_a11y_tree', 'agent.build_app_capability', 'desktop.screenshot', 'desktop.menu_click', 'desktop.press_keys', 'office.list_agents', 'research.search', 'approvals.request'],
    executionRequirements: [
      'Exact Adobe app/profile, source file or staged package, and output folder resolved before launch.',
      'Local desktop bridge with Accessibility and Screen Recording permissions.',
      'Use existing Adobe/InDesign/Photoshop bridge tools when available; otherwise build the smallest reusable app adapter before retrying.',
      'Approval before file mutation, save/export/render/encode, generative actions, scripts, plugins, or overwrites.',
    ],
    solutionSteps: [
      'Match the request to an Adobe Creative Cloud app profile and source file type.',
      'Observe app/window/file state before any mutation.',
      'Prefer app-native scripting, actions, command queues, documented plugin APIs, or file-format operations.',
      'Use accessibility/menu controls only when the app-native surface is unavailable and the UI target is verified.',
      'Delegate missing adapters to a connected agent with app name, file type, operation, and required smoke coverage.',
      'Verify with refreshed app state, screenshots, output file stats, and proof artifacts.',
    ],
    completionCriteria: ['The Adobe app task is completed and verified, staged behind approval, or blocked with an exact app/install/license/file/permission/adapter reason.'],
    approvalTriggers: ['Desktop app mutation, source-file changes, save/export/render/encode, batch processing, generative actions, running new scripts/actions/plugins, overwrites, or connected-agent adapter changes.'],
    persistenceTargets: ['computer_task_state', 'desktop_attachment_manifest', 'app_capability_recipe', 'run_ledger', 'proof_artifact', 'chat_message'],
    exampleQuestions: ['Open Illustrator and update this logo then export SVG.', 'Open After Effects and render the active comp to MP4.', 'Use Audition to clean this podcast audio and export a WAV.'],
  },
  {
    id: 'creative_image_design',
    title: 'Creative, Image, And Design',
    category: 'creative',
    description: 'Generate, edit, critique, or control creative work across images, Photoshop, Figma, UI, branding, and media.',
    matchers: [/\b(image|photo|photoshop|figma|canva|logo|brand|banner|mockup|ui|ux|design|illustration|retouch|edit photo|generate art)\b/i],
    routeId: 'hf_tools',
    executionKind: 'run_openswan',
    risk: 'review',
    preferredSurfaces: ['image_tools', 'desktop_bridge', 'figma', 'browser'],
    recommendedTools: ['desktop.launch_app', 'desktop.photoshop_document_status', 'desktop.photoshop_layer_inventory', 'desktop.photoshop_set_layer_state', 'desktop.photoshop_export_proof', 'research.search', 'agent.build_app_capability', 'desktop.screenshot', 'workspace.apply_artifacts', 'browser.screenshot'],
    solutionSteps: [
      'Classify whether the user wants critique, generation, asset editing, app control, or implementation.',
      'Use image generation/edit tools when asset output is needed.',
      'Use desktop bridge for Photoshop/Figma control when local app access is required.',
      'For Firefly, generative expand, or batch variants, capture prompt approval, generation receipts, output file stats, and before/after proof.',
      'Verify visual result with screenshot or preview.',
    ],
    completionCriteria: ['The creative artifact, critique, or app workflow is delivered with next edit options.'],
    approvalTriggers: ['Hands-on desktop control, publishing, external upload, or use of sensitive images.'],
    persistenceTargets: ['artifact', 'chat_message', 'brand_pack'],
    exampleQuestions: ['How good are you at Photoshop?', 'Create a logo.', 'Improve this UI.'],
  },
  {
    id: 'content_generation',
    title: 'Content Generation',
    category: 'creative',
    description: 'Write copy, emails, posts, docs, proposals, summaries, translations, and scripts.',
    matchers: [/\b(write|draft|summarize|translate|rewrite|compose|copy|email|post|article|proposal|script|caption)\b/i],
    routeId: 'hf_tools',
    executionKind: 'run_plain_chat',
    risk: 'safe',
    preferredSurfaces: ['chat', 'wiki', 'cms_when_needed'],
    recommendedTools: ['search_memories', 'research.search'],
    solutionSteps: [
      'Identify audience, tone, format, and destination.',
      'Draft the actual content instead of describing it.',
      'Offer variants when the brief is open.',
      'Escalate to CMS/email/browser only if the user asks to send or publish.',
    ],
    completionCriteria: ['Ready-to-use content is produced or a missing brief is requested.'],
    approvalTriggers: ['Sending, publishing, posting, or external delivery.'],
    persistenceTargets: ['chat_message', 'artifact'],
    exampleQuestions: ['Write an email to a client.', 'Summarize this page.', 'Draft a LinkedIn post.'],
  },
  {
    id: 'customer_support_crm',
    title: 'Customer Support And CRM',
    category: 'business',
    description: 'Triage tickets, classify customer issues, draft replies, update CRM records, and escalate support work.',
    matchers: [
      /\b(customer support|support tickets?|help ?desk|zendesk|intercom|freshdesk|support inbox|customer emails?|case queue)\b/i,
      /\b(triage|classify|prioriti[sz]e|reply|respond|escalate|resolve)\b.*\b(ticket|customer|support|case|email|inbox)\b/i,
      /\b(crm|salesforce|hubspot)\b.*\b(customer|ticket|case|contact|account)\b/i,
    ],
    routeId: null,
    executionKind: 'run_openswan',
    risk: 'review',
    preferredSurfaces: ['browser_bridge', 'integrations', 'office_dashboard', 'approvals'],
    recommendedTools: ['browser.open_url', 'browser.dom_snapshot', 'integrations.list', 'vault.resolve_for_task', 'approvals.request'],
    solutionSteps: [
      'Identify the support system, inbox, account, and requested outcome.',
      'Read ticket/customer context before writing or updating anything.',
      'Draft responses with tone, policy, and next action separated.',
      'Require approval before sending replies, closing tickets, refunds, or account changes.',
      'Persist the outcome to chat, ticket trace, and CRM/customer memory when useful.',
    ],
    completionCriteria: ['Tickets are triaged, replies are drafted, or CRM/support state is updated with proof and approvals.'],
    approvalTriggers: ['Sending replies, closing tickets, changing account records, refunds, or credential use.'],
    persistenceTargets: ['chat_message', 'support_trace', 'customer_memory', 'approval'],
    exampleQuestions: ['Triage support tickets and draft replies.', 'Update this customer in HubSpot.', 'Escalate angry Zendesk tickets.'],
  },
  {
    id: 'sales_leads_outreach',
    title: 'Sales Leads And Outreach',
    category: 'business',
    description: 'Research prospects, enrich lead lists, update CRM pipelines, draft outreach, and prepare proposals.',
    matchers: [
      /\b(leads?|prospects?|prospecting|lead list|outreach|cold email|sales pipeline|deal|opportunit(?:y|ies))\b/i,
      /\b(find|research|enrich|qualify|score|add|import)\b.*\b(leads?|prospects?|companies|contacts|crm)\b/i,
      /\b(draft|write|send|sequence)\b.*\b(outreach|cold email|sales email|follow[- ]?up|proposal)\b/i,
    ],
    routeId: null,
    executionKind: 'run_openswan',
    risk: 'external_side_effect',
    preferredSurfaces: ['browser_bridge', 'crm_integrations', 'marketplace_search', 'approvals'],
    recommendedTools: ['browser.data_extract', 'integrations.list', 'vault.resolve_for_task', 'approvals.request', 'research.search'],
    solutionSteps: [
      'Clarify ICP, source, geography, and success criteria when missing.',
      'Research and enrich leads with source URLs and confidence.',
      'Deduplicate against existing CRM records before creating new records.',
      'Draft outreach separately from sending.',
      'Require approval before CRM writes, external emails, or sequence enrollment.',
    ],
    completionCriteria: ['Lead records, outreach drafts, or CRM updates are prepared with sources and approval gates.'],
    approvalTriggers: ['Creating CRM records, sending email, enrolling sequences, credential use, or paid enrichment.'],
    persistenceTargets: ['chat_message', 'lead_artifact', 'crm_trace', 'approval'],
    exampleQuestions: ['Find 20 SaaS leads and add them to CRM.', 'Draft outreach for these prospects.', 'Research companies for this pipeline.'],
  },
  {
    id: 'analytics_reporting',
    title: 'Analytics And Reporting',
    category: 'business',
    description: 'Build KPI reports, dashboards, charts, summaries, forecasts, and metric investigations.',
    matchers: [
      /\b(analytics|metrics?|kpis?|dashboard|report|reporting|chart|graph|forecast|cohort|conversion|traffic|revenue)\b/i,
      /\b(build|create|generate|summarize|analy[sz]e|compare)\b.*\b(report|dashboard|metrics?|kpis?|data|chart|trend)\b/i,
      /\b(weekly|monthly|quarterly)\b.*\b(report|metrics?|summary|business review|scorecard)\b/i,
    ],
    routeId: null,
    executionKind: 'run_openswan',
    risk: 'safe',
    preferredSurfaces: ['artifacts', 'office_dashboard', 'data_tables', 'wiki'],
    recommendedTools: ['artifact.create', 'research.search', 'desktop.file_read', 'browser.data_extract'],
    solutionSteps: [
      'Identify source data, time range, metric definitions, and audience.',
      'Clean and summarize the data before visualization.',
      'Call out assumptions, missing fields, and anomalies.',
      'Create a report artifact with charts, summary, and recommended actions.',
    ],
    completionCriteria: ['A KPI/report artifact or metric explanation is produced with data lineage and caveats.'],
    approvalTriggers: ['Publishing externally, changing live dashboards, or connecting paid analytics providers.'],
    persistenceTargets: ['chat_message', 'report_artifact', 'digital_brain'],
    exampleQuestions: ['Build a weekly KPI dashboard.', 'Analyze conversion metrics.', 'Create a revenue trend report.'],
  },
  {
    id: 'meetings_calendar_email',
    title: 'Meetings, Calendar, And Email',
    category: 'workspace',
    description: 'Schedule meetings, check availability, send calendar invites, draft email replies, and summarize meeting notes.',
    matchers: [
      /\b(meeting|calendar|invite|appointment|availability|reschedule|book time|call)\b/i,
      /\b(schedule|book|reschedule|cancel|move)\b.*\b(meeting|call|appointment|calendar|invite)\b/i,
      /\b(send|draft|reply|follow up|follow-up)\b.*\b(email|calendar invite|meeting notes|recap)\b/i,
    ],
    routeId: null,
    executionKind: 'run_openswan',
    risk: 'external_side_effect',
    preferredSurfaces: ['desktop_bridge', 'browser_bridge', 'calendar_integrations', 'approvals'],
    recommendedTools: ['integrations.list', 'desktop.app_control', 'browser.form_submission', 'approvals.request'],
    solutionSteps: [
      'Identify attendees, date/time, timezone, location/link, and agenda.',
      'Read calendar/email context only as needed.',
      'Draft invites or replies before sending.',
      'Require approval before sending, canceling, or modifying calendar/email state.',
      'Save meeting outcomes and follow-ups when requested.',
    ],
    completionCriteria: ['Meeting/email work is drafted, scheduled, or summarized with clear confirmation and approvals.'],
    approvalTriggers: ['Sending email, creating/updating/canceling invites, credential use, or contacting external people.'],
    persistenceTargets: ['chat_message', 'calendar_trace', 'email_trace', 'approval'],
    exampleQuestions: ['Schedule a meeting and send invites.', 'Reply to this client email.', 'Summarize these meeting notes.'],
  },
  {
    id: 'data_import_export',
    title: 'Data Import, Export, And Cleanup',
    category: 'automation',
    description: 'Import/export CSVs, spreadsheets, database rows, records, tables, and cleanup/deduplicate structured data.',
    matchers: [
      /\b(csv|spreadsheet|excel|google sheets|sheet|rows?|columns?|table|database|records|exceptions?|etl|dedupe|normalize|clean data)\b/i,
      /\b(import|export|upload|download|sync|migrate|map|transform|merge)\b.*\b(csv|spreadsheet|sheet|table|database|records?|rows?|columns?)\b/i,
      /\b(clean|dedupe|normalize|merge|validate)\b.*\b(data|rows?|records?|spreadsheet|csv)\b/i,
    ],
    routeId: null,
    executionKind: 'run_openswan',
    risk: 'review',
    preferredSurfaces: ['artifacts', 'desktop_files', 'browser_bridge', 'supabase'],
    recommendedTools: ['desktop.file_read', 'artifact.create', 'browser.data_extract', 'verification.tests', 'approvals.request'],
    solutionSteps: [
      'Identify source, target, schema, mapping, and duplicate rules.',
      'Preview a sample and validate column assumptions before writing.',
      'Produce cleaned output or dry-run changes first.',
      'Require approval before importing into live systems or overwriting data.',
    ],
    completionCriteria: ['Data is cleaned/exported or a safe import plan/dry-run is produced with validation results.'],
    approvalTriggers: ['Live imports, overwrites, deletes, migrations, credential use, or external sync.'],
    persistenceTargets: ['chat_message', 'data_artifact', 'import_trace', 'approval'],
    exampleQuestions: ['Import this CSV into Supabase.', 'Clean and dedupe this spreadsheet.', 'Export customer records to CSV.'],
  },
  {
    id: 'finance_billing',
    title: 'Finance, Billing, And Invoices',
    category: 'business',
    description: 'Handle invoices, receipts, subscriptions, payments, refunds, reconciliation, and billing-system workflows.',
    matchers: [
      /\b(invoice|receipt|payment|billing|bill|stripe|quickbooks|bookkeeping|expense|refund|subscription|reconcile|tax)\b/i,
      /\b(create|send|pay|refund|reconcile|match|export)\b.*\b(invoice|receipt|payment|bill|expense|subscription|stripe|quickbooks)\b/i,
    ],
    routeId: null,
    executionKind: 'run_openswan',
    risk: 'external_side_effect',
    preferredSurfaces: ['browser_bridge', 'finance_integrations', 'vault', 'approvals'],
    recommendedTools: ['integrations.list', 'browser.form_submission', 'vault.resolve_for_task', 'approvals.request'],
    solutionSteps: [
      'Identify the finance platform, entity, amount, dates, and intended side effect.',
      'Read billing records before making changes.',
      'Draft invoices, refund notes, or reconciliation output before final action.',
      'Require explicit approval before money movement, invoices, refunds, subscription changes, or external sends.',
    ],
    completionCriteria: ['Finance work is drafted, reconciled, or completed with confirmation and an audit trail.'],
    approvalTriggers: ['Payments, refunds, invoice sends, subscription changes, credential use, or production billing writes.'],
    persistenceTargets: ['chat_message', 'billing_trace', 'approval', 'audit_log'],
    exampleQuestions: ['Create and send an invoice.', 'Reconcile this Stripe payment.', 'Export receipts from QuickBooks.'],
  },
  {
    id: 'document_intelligence',
    title: 'Document Intelligence',
    category: 'business',
    description: 'Extract, summarize, compare, OCR, classify, and reconcile PDFs, contracts, forms, images, and office documents.',
    matchers: [
      /\b(document intelligence|ocr|pdf extraction|document extraction|contract review|receipt extraction)\b/i,
      /\b(extract|summari[sz]e|compare|classify|analy[sz]e|review|reconcile)\b.*\b(pdf|document|contract|receipt|invoice|form|attachment|scan|image|docx|word file)\b/i,
      /\b(read|parse|pull fields from)\b.*\b(pdf|contract|receipt|form|attachment|scan)\b/i,
    ],
    routeId: null,
    executionKind: 'run_openswan',
    risk: 'review',
    preferredSurfaces: ['artifacts', 'desktop_files', 'vision_tools', 'vault_if_sensitive'],
    recommendedTools: ['desktop.file_read', 'vision.extract_text', 'artifact.create', 'approvals.request'],
    solutionSteps: [
      'Identify document type, requested fields, and sensitivity.',
      'Extract text/tables with OCR or document parsing when needed.',
      'Return structured fields with confidence and page/source references.',
      'Escalate low-confidence or legally/financially material decisions for human review.',
    ],
    completionCriteria: ['Document output is extracted, summarized, classified, or reconciled with source references and confidence.'],
    approvalTriggers: ['Legal/financial conclusions, exporting sensitive records, credential use, or external submission.'],
    persistenceTargets: ['chat_message', 'document_artifact', 'digital_brain', 'approval'],
    exampleQuestions: ['Extract fields from this PDF.', 'Summarize this contract.', 'OCR these scanned receipts.'],
  },
  {
    id: 'qa_testing',
    title: 'QA Testing And Regression',
    category: 'code',
    description: 'Run QA flows, browser tests, app regression checks, screenshots, bug reproduction, and release verification.',
    matchers: [
      /\b(qa|quality assurance|regression tests?|test flows?|acceptance tests?|e2e|end[- ]?to[- ]?end|playwright|cypress)\b/i,
      /\b(tests?|verify|reproduce|validate|check)\b.*\b(flow|scenario|website|app|screen|button|form|checkout|login|release)\b/i,
      /\b(screenshot|record)\b.*\b(test|flow|bug|regression)\b/i,
    ],
    routeId: 'browser',
    executionKind: 'run_computer_task',
    risk: 'review',
    preferredSurfaces: ['browser_bridge', 'playwright', 'desktop_bridge', 'verification'],
    recommendedTools: ['browser.open_url', 'browser.dom_snapshot', 'browser.screenshot', 'verification.tests', 'artifact.create'],
    solutionSteps: [
      'Identify the target environment, flow, expected result, and test data.',
      'Prefer deterministic selectors and repeatable browser steps.',
      'Capture screenshots/logs for failures.',
      'Report pass/fail with reproduction steps and suggested fix path.',
    ],
    completionCriteria: ['The QA flow is executed or converted into a repeatable test with pass/fail evidence.'],
    approvalTriggers: ['Production writes, real payments, destructive actions, or credential use.'],
    persistenceTargets: ['chat_message', 'qa_trace', 'artifact', 'agent_runs'],
    exampleQuestions: ['Test the checkout flow.', 'Run regression on login.', 'Reproduce this bug in the browser.'],
  },
  {
    id: 'it_support_ops',
    title: 'IT Support And Ops',
    category: 'workspace',
    description: 'Handle internal IT tickets, account provisioning, app access, device troubleshooting, Jira/ServiceNow work, and ops runbooks.',
    matchers: [
      /\b(it support|service ?now|jira ticket|help desk|employee request|access request|account provisioning|password reset|device issue)\b/i,
      /\b(provision|deprovision|grant access|remove access|reset|troubleshoot|route|assign)\b.*\b(account|user|employee|teammate|team member|ticket|device|laptop|app access|permission|access|slack|jira|notion|google workspace)\b/i,
      /\b(runbook|incident|ops|on-call|sla)\b.*\b(ticket|support|service|workflow|resolution)\b/i,
    ],
    routeId: null,
    executionKind: 'run_openswan',
    risk: 'external_side_effect',
    preferredSurfaces: ['browser_bridge', 'desktop_bridge', 'integrations', 'approvals'],
    recommendedTools: ['integrations.list', 'browser.form_submission', 'vault.resolve_for_task', 'approvals.request'],
    solutionSteps: [
      'Identify the requester, system, access level, and policy requirements.',
      'Read ticket/context before any account change.',
      'Draft or execute runbook steps with approval gates.',
      'Record resolution, evidence, and follow-up tasks.',
    ],
    completionCriteria: ['IT ticket or ops workflow is resolved, routed, or staged with audit evidence.'],
    approvalTriggers: ['Account access changes, password resets, device actions, credential use, or closing tickets.'],
    persistenceTargets: ['chat_message', 'ops_trace', 'approval', 'audit_log'],
    exampleQuestions: ['Provision access for a new teammate.', 'Route these ServiceNow tickets.', 'Troubleshoot this laptop issue.'],
  },
  {
    id: 'compliance_monitoring',
    title: 'Compliance Monitoring',
    category: 'security',
    description: 'Monitor regulatory changes, policies, audit evidence, risk controls, and compliance tasks.',
    matchers: [
      /\b(compliance|regulatory|policy|audit evidence|risk control|soc 2|hipaa|gdpr|pci|legal review)\b/i,
      /\b(monitor|check|review|track|map|collect)\b.*\b(policy|regulation|control|audit|risk|evidence|compliance)\b/i,
      /\b(terms|privacy policy|data processing|security questionnaire)\b/i,
    ],
    routeId: null,
    executionKind: 'run_openswan',
    risk: 'review',
    preferredSurfaces: ['research_corpus', 'wiki', 'artifacts', 'approvals'],
    recommendedTools: ['research.search', 'fetch_url', 'artifact.create', 'approvals.request'],
    solutionSteps: [
      'Identify jurisdiction, framework, policy, and evidence scope.',
      'Use authoritative sources for current regulatory claims.',
      'Map requirements to controls, owners, and proof artifacts.',
      'Avoid legal conclusions; present risk and recommended review path.',
    ],
    completionCriteria: ['Compliance findings, control mapping, or evidence checklist is produced with source context.'],
    approvalTriggers: ['Policy publication, legal/regulated claims, external filing, or production control changes.'],
    persistenceTargets: ['chat_message', 'compliance_artifact', 'digital_brain', 'approval'],
    exampleQuestions: ['Monitor regulatory changes.', 'Build a SOC 2 evidence checklist.', 'Review this privacy policy.'],
  },
  {
    id: 'hr_onboarding',
    title: 'HR Onboarding And People Ops',
    category: 'workspace',
    description: 'Create onboarding plans, provision first-day tasks, send welcome materials, collect forms, and manage people ops workflows.',
    matchers: [
      /\b(hr|people ops|new hire|onboarding|offboarding|employee onboarding|welcome packet|first day|employee forms?)\b/i,
      /\b(create|send|prepare|schedule|provision|collect)\b.*\b(onboarding|new hire|employee|welcome|first day|hr forms?|training)\b/i,
      /\b(training plan|employee checklist|offboarding checklist)\b/i,
    ],
    routeId: 'mission',
    executionKind: 'run_command_handler',
    risk: 'external_side_effect',
    defaultCommand: '/task new ',
    preferredSurfaces: ['missions', 'tasks', 'calendar_integrations', 'approvals'],
    recommendedTools: ['tasks.create', 'schedule_action', 'integrations.list', 'approvals.request'],
    solutionSteps: [
      'Identify employee, role, start date, systems, and required forms.',
      'Create checklist/tasks for each owner.',
      'Draft welcome/training materials before sending.',
      'Require approval before account provisioning or external communications.',
    ],
    completionCriteria: ['Onboarding/offboarding plan, tasks, or communications are created with owners and dates.'],
    approvalTriggers: ['Provisioning access, sending employee communications, collecting sensitive forms, or calendar invites.'],
    persistenceTargets: ['tasks', 'missions', 'chat_message', 'approval'],
    exampleQuestions: ['Create a new-hire onboarding checklist.', 'Prepare first-day tasks.', 'Offboard this employee.'],
  },
  {
    id: 'marketing_campaigns',
    title: 'Marketing Campaigns',
    category: 'business',
    description: 'Plan, draft, segment, launch, measure, and optimize email, social, ad, SEO, and content campaigns.',
    matchers: [
      /\b(marketing campaign|email campaign|newsletter|seo|ad campaign|paid ads|social campaign|content calendar|a\/b test|segment audience)\b/i,
      /\b(plan|draft|launch|schedule|segment|personalize|measure|optimi[sz]e)\b.*\b(campaign|newsletter|email list|audience|ads?|social posts?|landing page|seo)\b/i,
      /\b(mailchimp|klaviyo|hubspot marketing|google ads|meta ads|linkedin ads)\b/i,
    ],
    routeId: null,
    executionKind: 'run_openswan',
    risk: 'external_side_effect',
    preferredSurfaces: ['browser_bridge', 'integrations', 'content_artifacts', 'approvals'],
    recommendedTools: ['research.search', 'browser.form_submission', 'integrations.list', 'artifact.create', 'approvals.request'],
    solutionSteps: [
      'Identify audience, offer, channel, calendar, and conversion goal.',
      'Create campaign assets and segmentation logic separately from launch.',
      'Preview copy, links, tracking, and targeting before external send or publish.',
      'Persist learnings and results back into the digital brain.',
    ],
    completionCriteria: ['Campaign plan/assets/reporting are produced or launch is staged behind approval.'],
    approvalTriggers: ['Sending campaigns, publishing ads/social posts, changing budgets, credential use, or external writes.'],
    persistenceTargets: ['chat_message', 'campaign_artifact', 'approval', 'digital_brain'],
    exampleQuestions: ['Plan an email campaign.', 'Segment this audience for a newsletter.', 'Draft and schedule social posts.'],
  },
  {
    id: 'workflow_recording_replay',
    title: 'Workflow Recording And Replay',
    category: 'automation',
    description: 'Record manual browser/desktop workflows, convert them into reusable automations, replay them, and adapt them safely.',
    matchers: [
      /\b(record workflow|workflow recording|record and replay|replay workflow|saved workflow|automation template|macro)\b/i,
      /\b(record|capture|save)\b.*\b(steps|workflow|process|routine|browser flow|desktop flow|flow)\b/i,
      /\b(replay|rerun|repeat|reuse|turn into automation)\b.*\b(workflow|steps|process|task|routine|flow)\b/i,
    ],
    routeId: null,
    executionKind: 'run_openswan',
    risk: 'review',
    preferredSurfaces: ['browser_bridge', 'desktop_bridge', 'scheduled_actions', 'approvals'],
    recommendedTools: ['browser.trace_start', 'desktop.trace_start', 'artifact.create', 'schedule_action', 'approvals.request'],
    solutionSteps: [
      'Identify the workflow start/end state and whether browser, desktop, or both are involved.',
      'Capture user-visible steps with selectors, screenshots, and semantic intent.',
      'Generate a reusable runbook with variables, secrets, and approval gates separated.',
      'Dry-run before scheduled or unattended replay.',
    ],
    completionCriteria: ['Workflow is captured, converted into a reusable runbook, or replayed with proof and approval gates.'],
    approvalTriggers: ['Replay that changes external systems, credentials, scheduled runs, or destructive actions.'],
    persistenceTargets: ['automation_template', 'browser_plan', 'desktop_trace', 'approval'],
    exampleQuestions: ['Record this workflow and replay it later.', 'Turn these steps into an automation.', 'Rerun my saved weekly process.'],
  },
  {
    id: 'travel_booking',
    title: 'Travel And Booking',
    category: 'business',
    description: 'Research, compare, reserve, or manage flights, hotels, rental cars, restaurants, events, and itineraries.',
    matchers: [
      /\b(travel|trip|flight|hotel|airbnb|rental car|reservation|itinerary|restaurant booking|book a table|tickets?)\b/i,
      /\b(book|reserve|compare|find|change|cancel)\b.*\b(flight|hotel|room|rental car|restaurant|trip|ticket|reservation|appointment)\b/i,
      /\b(itinerary|boarding pass|check[- ]?in|seat selection|travel dates?)\b/i,
    ],
    routeId: null,
    executionKind: 'run_openswan',
    risk: 'external_side_effect',
    preferredSurfaces: ['browser_bridge', 'calendar_integrations', 'vault', 'approvals'],
    recommendedTools: ['browser.open_url', 'browser.data_extract', 'vault.resolve_for_task', 'approvals.request'],
    executionRequirements: [
      'Destination, dates, travelers, budget, preferences, and required loyalty/login context.',
      'Browser access for live availability and pricing.',
      'Explicit approval before booking, payment, cancellation, or account changes.',
    ],
    solutionSteps: [
      'Clarify destination, dates, traveler count, budget, and constraints when missing.',
      'Compare options with live source URLs and total price assumptions.',
      'Stage booking steps without payment until approval.',
      'Persist itinerary details and confirmation proof after completion.',
    ],
    completionCriteria: ['Travel options are compared or booking changes are completed with confirmation proof and approvals.'],
    approvalTriggers: ['Booking, payment, cancellation, loyalty-account use, passport/personal data entry, or external send.'],
    persistenceTargets: ['chat_message', 'travel_artifact', 'calendar_trace', 'approval'],
    exampleQuestions: ['Find and book a hotel for next weekend.', 'Compare flights to Austin.', 'Reserve a dinner table.'],
  },
  {
    id: 'procurement_shopping',
    title: 'Procurement And Shopping',
    category: 'business',
    description: 'Compare products, manage carts, reorder supplies, purchase software, process vendor quotes, and track deliveries.',
    matchers: [
      /\b(procurement|purchase order|vendor quote|reorder|shopping cart|buy|order supplies|software license|subscription purchase)\b/i,
      /\b(compare|find|buy|order|reorder|purchase|quote|source)\b.*\b(product|supplies|vendor|license|subscription|equipment|cart|price)\b/i,
      /\b(track|return|refund)\b.*\b(order|shipment|package|purchase|delivery)\b/i,
    ],
    routeId: null,
    executionKind: 'run_openswan',
    risk: 'external_side_effect',
    preferredSurfaces: ['browser_bridge', 'browserbase_stagehand', 'vault', 'approvals'],
    recommendedTools: ['browser.data_extract', 'browser.form_submission', 'vault.resolve_for_task', 'approvals.request'],
    executionRequirements: [
      'Item specs, quantity, budget, vendor constraints, shipping destination, and approval limit.',
      'Live browser session for price/availability checks.',
      'Explicit approval before checkout, payment, subscription, return, or vendor communication.',
    ],
    solutionSteps: [
      'Collect product requirements, quantity, budget, and vendor constraints.',
      'Compare options with price, shipping, return policy, and source URLs.',
      'Stage carts or purchase orders without payment until approval.',
      'Record order/quote status and tracking evidence.',
    ],
    completionCriteria: ['Comparison, cart, purchase order, or order status is delivered with approval/proof.'],
    approvalTriggers: ['Checkout, payment, subscription changes, returns, vendor messages, or credential use.'],
    persistenceTargets: ['chat_message', 'procurement_artifact', 'approval', 'audit_log'],
    exampleQuestions: ['Find the best laptop under $1500.', 'Reorder office supplies.', 'Track this shipment.'],
  },
  {
    id: 'cloud_devops',
    title: 'Cloud DevOps And Incidents',
    category: 'code',
    description: 'Investigate deploys, CI/CD, cloud resources, logs, incidents, uptime, environment variables, and infrastructure changes.',
    matchers: [
      /\b(devops|ci\/cd|github actions|vercel|netlify|aws|gcp|azure|cloudflare|docker|kubernetes|terraform|supabase edge|deployment|incident)\b/i,
      /\b(deploy|rollback|restart|scale|inspect|check|tail|query)\b.*\b(logs?|service|function|server|container|deployment|workflow|infra|cloud|database)\b/i,
      /\b(outage|downtime|error rate|uptime|status page|environment variables?|secrets?)\b/i,
    ],
    routeId: null,
    executionKind: 'run_openswan',
    risk: 'review',
    preferredSurfaces: ['code_tools', 'terminal_bridge', 'cloud_console', 'approvals'],
    recommendedTools: ['code.inspect', 'verification.tests', 'office.list_agents', 'approvals.request'],
    executionRequirements: [
      'Target environment, repository/service, provider, credentials/integration status, and desired change.',
      'Read-only diagnostics before mutations.',
      'Approval before deploy, rollback, scaling, secret changes, or production data operations.',
    ],
    solutionSteps: [
      'Identify environment, service, recent changes, and blast radius.',
      'Run read-only diagnostics before mutating infrastructure.',
      'Produce an incident timeline, likely cause, and safest action.',
      'Require approval for deploy, rollback, scaling, secret, or production changes.',
    ],
    completionCriteria: ['Incident/deploy state is diagnosed or changed with logs, verification, and rollback notes.'],
    approvalTriggers: ['Deploy, rollback, restart, scale, secret changes, DNS changes, or production database writes.'],
    persistenceTargets: ['chat_message', 'incident_trace', 'agent_runs', 'approval'],
    exampleQuestions: ['Check why the deployment failed.', 'Rollback the last deploy after approval.', 'Tail Supabase function logs.'],
  },
  {
    id: 'social_community',
    title: 'Social And Community Operations',
    category: 'business',
    description: 'Moderate comments, respond to DMs, schedule social posts, manage communities, and summarize audience sentiment.',
    matchers: [
      /\b(social media|community|comments?|dms?|direct messages|discord|slack community|reddit|twitter|x post|linkedin post|instagram|facebook group)\b/i,
      /\b(moderate|reply|respond|schedule|post|summari[sz]e|analy[sz]e)\b.*\b(comments?|dms?|messages?|community|discord|reddit|social|followers?)\b/i,
      /\b(sentiment|community moderation|brand mentions|mentions)\b/i,
    ],
    routeId: null,
    executionKind: 'run_openswan',
    risk: 'external_side_effect',
    preferredSurfaces: ['browser_bridge', 'social_integrations', 'approvals', 'content_artifacts'],
    recommendedTools: ['browser.dom_snapshot', 'browser.form_submission', 'artifact.create', 'approvals.request'],
    executionRequirements: [
      'Target platform/account, moderation policy, voice/tone rules, and posting permissions.',
      'Read-only review before replies, deletions, bans, or posts.',
      'Approval before public posting, direct messages, deletes, bans, or moderation actions.',
    ],
    solutionSteps: [
      'Identify platform, account, audience, and moderation policy.',
      'Read and categorize messages before taking action.',
      'Draft responses/moderation actions separately from executing them.',
      'Capture public-post or moderation proof after approval.',
    ],
    completionCriteria: ['Community content is summarized, drafted, scheduled, or moderated with proof and approval gates.'],
    approvalTriggers: ['Public posts, DMs, deleting comments, banning users, credential use, or ad/budget changes.'],
    persistenceTargets: ['chat_message', 'community_trace', 'content_artifact', 'approval'],
    exampleQuestions: ['Moderate Discord messages.', 'Reply to Instagram DMs.', 'Summarize brand mentions.'],
  },
  {
    id: 'inbox_notifications',
    title: 'Inbox And Notification Triage',
    category: 'workspace',
    description: 'Summarize, prioritize, label, archive, or route email, Slack, notifications, messages, and alerts.',
    matchers: [
      /\b(inbox|unread emails?|notifications?|slack messages?|teams messages?|alerts?|mentions|priority messages?)\b/i,
      /\b(triage|prioriti[sz]e|summari[sz]e|label|archive|route|clean up)\b.*\b(inbox|email|messages?|notifications?|alerts?|slack|teams)\b/i,
      /\b(inbox zero|unread summary|daily digest)\b/i,
    ],
    routeId: null,
    executionKind: 'run_openswan',
    risk: 'review',
    preferredSurfaces: ['desktop_bridge', 'browser_bridge', 'integrations', 'approvals'],
    recommendedTools: ['integrations.list', 'desktop.app_control', 'browser.dom_snapshot', 'approvals.request'],
    executionRequirements: [
      'Target inbox/platform, time range, prioritization rules, and allowed actions.',
      'Read-only summary before archive/delete/reply/label actions.',
      'Approval before sending, deleting, archiving at scale, or changing notification settings.',
    ],
    solutionSteps: [
      'Identify inbox/platform, time range, and prioritization rules.',
      'Summarize unread or alert state by urgency, owner, and action needed.',
      'Draft replies or routing recommendations before changing state.',
      'Record labels/archive/reply actions after approval.',
    ],
    completionCriteria: ['Inbox/notification state is summarized, prioritized, or updated with proof and approvals.'],
    approvalTriggers: ['Sending messages, deleting, archiving, muting, bulk label changes, or credential use.'],
    persistenceTargets: ['chat_message', 'inbox_trace', 'approval', 'tasks'],
    exampleQuestions: ['Summarize my unread emails.', 'Prioritize Slack mentions.', 'Clean up notifications after I approve.'],
  },
  {
    id: 'learning_training',
    title: 'Learning And Training',
    category: 'workspace',
    description: 'Teach concepts, create training plans, quizzes, tutorials, onboarding lessons, and skill-building paths.',
    matchers: [
      /\b(teach me|learn|training|tutorial|course|lesson plan|study plan|quiz|flashcards|explain like|practice questions)\b/i,
      /\b(create|build|generate|make)\b.*\b(training|course|tutorial|lesson|quiz|study plan|learning path|flashcards)\b/i,
      /\b(onboarding lesson|enablement|curriculum|workshop)\b/i,
    ],
    routeId: null,
    executionKind: 'run_plain_chat',
    risk: 'safe',
    preferredSurfaces: ['chat', 'wiki', 'digital_brain', 'artifacts'],
    recommendedTools: ['research.search', 'artifact.create', 'search_memories'],
    executionRequirements: [
      'Learner level, goal, format, time budget, and any source materials.',
      'Internal knowledge/wiki context when training should match the app or company.',
      'Artifact output when the user needs reusable lessons, quizzes, or checklists.',
    ],
    solutionSteps: [
      'Identify learner level, goal, format, and time budget.',
      'Use examples and checkpoints instead of generic explanation.',
      'Create reusable artifacts when the user asks for training material.',
      'Save durable learning plans or company-specific training into the digital brain when useful.',
    ],
    completionCriteria: ['A lesson, plan, quiz, or direct explanation is delivered at the right level.'],
    approvalTriggers: ['Publishing training externally or saving personal performance data.'],
    persistenceTargets: ['chat_message', 'training_artifact', 'digital_brain'],
    exampleQuestions: ['Teach me GraphQL.', 'Build a training plan for new engineers.', 'Create a quiz from this document.'],
  },
  {
    id: 'high_stakes_advice',
    title: 'High-Stakes Advice Guardrail',
    category: 'security',
    description: 'Handle medical, legal, tax, financial, insurance, and safety advice with sources, uncertainty, and professional escalation.',
    matchers: [
      /\b(medical|doctor|symptom|diagnosis|medicine|medication|prescription|legal advice|lawyer|lawsuit|tax advice|investment advice|financial advice|insurance claim|safety risk|chest pain)\b/i,
      /\b(should i|can i|is it safe|am i allowed|what should i do)\b.*\b(medicine|medication|legal|tax|invest|health|insurance|injury|contract|lawsuit|chest pain)\b/i,
      /\b(emergency|self harm|harm myself|chest pain|stroke|suicide)\b/i,
    ],
    routeId: null,
    executionKind: 'run_plain_chat',
    risk: 'review',
    preferredSurfaces: ['chat', 'research_corpus', 'professional_referral'],
    recommendedTools: ['research.search', 'fetch_url'],
    executionRequirements: [
      'Clarify jurisdiction/context only if needed for non-urgent guidance.',
      'Use authoritative sources for current claims.',
      'Do not diagnose, prescribe, provide legal/tax determinations, or execute irreversible decisions.',
    ],
    solutionSteps: [
      'Give safe general information and identify uncertainty.',
      'Recommend the appropriate professional or emergency path when risk is high.',
      'Offer a checklist of questions/documents to prepare.',
      'Avoid automating high-stakes external actions without explicit professional/user approval.',
    ],
    completionCriteria: ['The user receives safe general guidance, limits, and the correct escalation path.'],
    approvalTriggers: ['Any external filing, payment, medical/legal/tax/insurance submission, or regulated account change.'],
    persistenceTargets: ['chat_message', 'safety_note'],
    exampleQuestions: ['Is this contract legal?', 'Should I take this medication?', 'What should I do about this tax notice?'],
  },
  {
    id: 'tasks_missions',
    title: 'Tasks, Missions, And Accountability',
    category: 'workspace',
    description: 'Create, assign, update, report, or plan tasks, missions, goals, check-ins, and accountability work.',
    matchers: [/\b(task|todo|mission|goal|okr|assign|deadline|check[- ]?in|streak|kanban|proof of work|progress)\b/i],
    routeId: 'mission',
    executionKind: 'run_command_handler',
    risk: 'safe',
    defaultCommand: '/mission status',
    preferredSurfaces: ['feeds_dashboard', 'kanban', 'missions', 'office_agents'],
    recommendedTools: ['tasks.list', 'tasks.create', 'tasks.assign', 'missions.list', 'check_ins.list'],
    solutionSteps: [
      'Read current task/mission state first when status matters.',
      'Create or update concrete tasks when the user asks for action.',
      'Assign ownership and deadlines when enough information exists.',
      'Post a concise progress summary.',
    ],
    completionCriteria: ['Tasks or mission state are updated or summarized with clear next actions.'],
    approvalTriggers: ['Assigning work to another member when ambiguity exists.'],
    persistenceTargets: ['tasks', 'missions', 'chat_message'],
    exampleQuestions: ['Create a task for this.', 'What missions are active?', 'Assign this to the agent.'],
  },
  {
    id: 'office_agents',
    title: 'Office Agents And Control Panel',
    category: 'automation',
    description: 'Manage OpenSwan, agents, rosters, models, control panel settings, agent memories, and Office dashboard state.',
    matchers: [/\b(office dashboard|office agents?|openswan control panel|agent roster|agent memories|customize agent|published agents|agent helper)\b/i],
    routeId: null,
    executionKind: 'run_openswan',
    risk: 'safe',
    preferredSurfaces: ['office_dashboard', 'openswan_control_panel'],
    recommendedTools: ['office.list_agents', 'search_memories', 'messages.create'],
    solutionSteps: [
      'Load live agent roster and saved identity/memory state.',
      'Determine whether the request is UI cleanup, configuration, orchestration, or memory.',
      'Persist durable customizations to the user/circle account.',
    ],
    completionCriteria: ['Office/agent state is updated, summarized, or routed to the correct panel.'],
    approvalTriggers: ['Launching agents, changing model/API keys, or granting credentials.'],
    persistenceTargets: ['agent_identities', 'office_roster', 'user_memory'],
    exampleQuestions: ['Customize terminal sessions in Office.', 'Show what agents are doing.', 'Improve the Control Panel.'],
  },
  {
    id: 'integrations_models',
    title: 'Integrations, Models, And API Keys',
    category: 'business',
    description: 'Connect marketplace providers, save API keys securely, route models, and choose the best model for a task.',
    matchers: [/\b(integration|marketplace|api key|provider|model picker|openrouter|hugging ?face|anthropic|openai|google ai|gemini|brave search|browserbase|auto picker|smart route)\b/i],
    routeId: null,
    executionKind: 'run_openswan',
    risk: 'review',
    preferredSurfaces: ['marketplace', 'model_registry', 'llm_proxy'],
    recommendedTools: ['integrations.list', 'code.inspect', 'verification.tests'],
    solutionSteps: [
      'Identify provider, key scope, user/circle ownership, and target surfaces.',
      'Use user-provided keys for non-owner users; never fall back to platform keys unless allowed.',
      'Update model routing so Auto considers connected providers and task fit.',
      'Verify chat, OpenSwan, and marketplace paths all resolve the same credential policy.',
    ],
    completionCriteria: ['Integration/model state is saved securely and reflected in chat routing.'],
    approvalTriggers: ['Saving/rotating keys, changing provider routing, or using paid APIs.'],
    persistenceTargets: ['circle_integrations', 'user_api_keys', 'model_routing'],
    exampleQuestions: ['Make Hugging Face work in chat.', 'Add Brave Search.', 'Why am I charged for Anthropic?'],
  },
  {
    id: 'schedule_automation',
    title: 'Scheduled And Recurring Automation',
    category: 'automation',
    description: 'Create, review, pause, run, or debug cron jobs, scheduled actions, recurring workflows, and agent routines.',
    matchers: [/\b(schedule|cron|recurring|daily|weekly|automation|workflow|pipeline|runner|background job|reminder|send later)\b/i],
    routeId: 'schedule',
    executionKind: 'run_command_handler',
    risk: 'review',
    defaultCommand: '/cron',
    preferredSurfaces: ['scheduled_actions', 'office_cron', 'automation_templates'],
    recommendedTools: ['schedule_action', 'approvals.request', 'office.list_agents'],
    solutionSteps: [
      'Classify whether the user wants to create, list, run, pause, or debug automation.',
      'Check existing jobs to prevent duplicate recurring work.',
      'Add approval gates for external side effects.',
      'Persist run cadence, owner, target, and failure notifications.',
    ],
    completionCriteria: ['The schedule is created/updated or existing automation state is clearly reported.'],
    approvalTriggers: ['Recurring external sends, paid API calls, credentials, or production writes.'],
    persistenceTargets: ['scheduled_actions', 'cron_jobs', 'approvals'],
    exampleQuestions: ['Set up a daily research job.', 'Are cron jobs still running?', 'Automate this every morning.'],
  },
  {
    id: 'governance_approvals',
    title: 'Governance And Approvals',
    category: 'workspace',
    description: 'Create proposals, polls, approvals, pins, and human-in-the-loop decisions.',
    matchers: [/\b(approval|approve|reject|proposal|poll|vote|governance|pin|human in the loop|hitl)\b/i],
    routeId: 'governance',
    executionKind: 'run_command_handler',
    risk: 'safe',
    defaultCommand: '/proposals',
    preferredSurfaces: ['approvals', 'governance', 'feed'],
    recommendedTools: ['approvals.list', 'approvals.request', 'approvals.resolve'],
    solutionSteps: [
      'Determine whether the user wants to create, list, resolve, or explain an approval/proposal.',
      'Keep side-effect approvals explicit and human-readable.',
      'Persist the outcome and link it to the originating run/task.',
    ],
    completionCriteria: ['Approval or governance state is visible and actionable.'],
    approvalTriggers: ['Resolving someone else’s approval or executing a pending side effect.'],
    persistenceTargets: ['approvals', 'governance', 'chat_message'],
    exampleQuestions: ['Approve this run.', 'Create a poll.', 'Show pending approvals.'],
  },
  {
    id: 'human_verification',
    title: 'Human Verification Gate',
    category: 'security',
    description: 'Detect CAPTCHA, MFA, OTP, bot checks, and pause automation for human completion.',
    matchers: [/\b(captcha|recaptcha|hcaptcha|turnstile|not a robot|human verification|bot verification|cloudflare|2fa|mfa|otp|verification code)\b/i],
    routeId: 'browser',
    executionKind: 'run_computer_task',
    risk: 'review',
    preferredSurfaces: ['browser_bridge', 'approval_gate'],
    recommendedTools: ['browser.verification_state', 'approvals.request'],
    solutionSteps: [
      'Detect the verification gate before any click/fill.',
      'Stop automation and tell the human exactly what to complete.',
      'Resume only after the user confirms the gate is cleared.',
    ],
    completionCriteria: ['Automation pauses safely and resumes only after human verification.'],
    approvalTriggers: ['Any CAPTCHA/MFA/OTP/bot-check interaction.'],
    persistenceTargets: ['approval', 'browser_plan', 'chat_message'],
    exampleQuestions: ['There is an I am not a robot checkbox.', 'It asks for MFA.', 'Cloudflare is blocking the task.'],
  },
];

const PIPELINE_TIEBREAK_PRIORITY: Partial<Record<UserTaskPipelineId, number>> = {
  human_verification: 100,
  vault_credentials: 95,
  terminal_agents: 92,
  desktop_awareness: 90,
  bridge_troubleshooting: 89,
  desktop_app_control: 88,
  browser_form_submission: 86,
  wordpress_cms: 84,
  website_platform_admin: 83,
  finance_billing: 82,
  customer_support_crm: 80,
  sales_leads_outreach: 78,
  adobe_creative_cloud: 77,
  it_support_ops: 76,
  compliance_monitoring: 74,
  hr_onboarding: 72,
  creative_layout_design: 79,
  marketing_campaigns: 70,
  workflow_recording_replay: 68,
  travel_booking: 67,
  procurement_shopping: 65,
  document_intelligence: 66,
  data_import_export: 64,
  analytics_reporting: 62,
  qa_testing: 60,
  cloud_devops: 58,
  social_community: 56,
  inbox_notifications: 55,
  coding_build: 54,
  debug_fix: 52,
  code_review: 50,
  performance_cost: 48,
  learning_training: 28,
  high_stakes_advice: 26,
  content_generation: 20,
  capability_explanation: 12,
  direct_answer: 1,
};

function scorePipeline(message: string, pipeline: UserTaskPipelineDefinition): UserTaskPipelineMatch | null {
  const text = String(message || '').trim();
  if (!text) return null;
  const reasons: string[] = [];
  let score = 0;

  for (const matcher of pipeline.matchers) {
    if (matcher.test(text)) {
      score += matcher === URL_RE ? 1.5 : 2;
      reasons.push(`matched ${matcher.source.slice(0, 48)}`);
    }
  }

  for (const matcher of pipeline.negativeMatchers || []) {
    if (matcher.test(text)) {
      score -= 3;
      reasons.push(`negative ${matcher.source.slice(0, 48)}`);
    }
  }

  if (pipeline.category === 'browser' && URL_RE.test(text)) score += 1;
  if (pipeline.id === 'local_files' && FILE_PATH_RE.test(text)) score += 2;
  if (pipeline.id === 'local_files' && /\b(upload|attach|download|export|import|save as pdf|print to pdf)\b/i.test(text) && /\b(desktop|downloads?|documents?|file|image|photo|pdf|csv|spreadsheet)\b/i.test(text)) score += 4;
  if (pipeline.id === 'debug_fix' && STACK_TRACE_RE.test(text)) score += 3;
  if (pipeline.id === 'coding_build' && CODE_RE.test(text)) score += 1.5;
  if (pipeline.id === 'human_verification' && /\b(click|solve|bypass)\b/i.test(text)) score += 2;
  if (pipeline.id === 'terminal_agents' && /\b\d+\b.*\b(sessions?|agents?)\b/i.test(text)) score += 2;
  if (pipeline.id === 'vault_credentials' && /\b(log ?in|log into|sign ?in|password|saved credentials?|saved login)\b/i.test(text)) score += 2;
  if (pipeline.id === 'vault_credentials' && /\b(vault|password|credentials?|secrets?|saved login|login info)\b/i.test(text)) score += 3;
  if (
    pipeline.id === 'wordpress_cms' &&
    /\b(vault|password|credential|secret)\b/i.test(text) &&
    !/\b(draft|publish|post|page|blog|cms|edit|schedule)\b/i.test(text)
  ) score -= 3;
  if (pipeline.id === 'browser_form_submission' && /\b(log ?in|sign ?in|credential|password|saved login)\b/i.test(text)) score += 2;
  if (pipeline.id === 'desktop_awareness' && /\b(tabs?|open apps?|running apps?|screen|window|clipboard)\b/i.test(text)) score += 3;
  if (pipeline.id === 'desktop_awareness' && /\b(chrome tabs?|safari tabs?|browser tabs?)\b/i.test(text)) score += 1;
  if (pipeline.id === 'desktop_app_control' && /\b(tabs?|what apps?|which apps?|running apps?)\b/i.test(text)) score -= 2;
  if (pipeline.id === 'desktop_awareness' && /\b(captcha|recaptcha|hcaptcha|turnstile|human verification|bot verification|cloudflare|mfa|otp)\b/i.test(text)) score -= 3;
  if (pipeline.id === 'desktop_awareness' && /\b(can'?t|cannot|unable|blocked|404|not found|cors|preflight|x-uc-desktop-token|unknown \/desktop endpoint|bridge)\b/i.test(text)) score -= 1;
  if (pipeline.id === 'bridge_troubleshooting' && /\b(bridge|cors|preflight|x-uc-desktop-token|404|not found|unknown \/desktop endpoint|browser_tabs|desktop\/browser_tabs)\b/i.test(text)) score += 5;
  if (pipeline.id === 'bridge_troubleshooting' && /\b(can'?t|cannot|unable|blocked|offline|not connected|not working|not running)\b.*\b(tabs?|chrome|safari|browser|desktop|computer)\b/i.test(text)) score += 4;
  if (pipeline.id === 'bridge_troubleshooting' && !/\b(can'?t|cannot|unable|blocked|offline|not connected|not working|not running|bridge|cors|404|unknown \/desktop endpoint)\b/i.test(text)) score -= 3;
  if (pipeline.id === 'wordpress_cms' && /\bwordpress|wp admin|blog post\b/i.test(text)) score += 3;
  if (pipeline.id === 'wordpress_cms' && /\b(shopify|webflow|wix|squarespace|woocommerce|bigcommerce|framer|godaddy|site builder|website builder|store admin)\b/i.test(text)) score -= 4;
  if (pipeline.id === 'website_platform_admin' && /\b(shopify|webflow|wix|squarespace|woocommerce|bigcommerce|framer|godaddy|site builder|website builder|ecommerce|store admin)\b/i.test(text)) score += 5;
  if (
    pipeline.id === 'website_platform_admin' &&
    /\b(shopify|webflow|wix|squarespace|woocommerce|bigcommerce|framer|godaddy|site builder|website builder|ecommerce|store admin|website|store|cms)\b/i.test(text) &&
    /\b(log ?in|sign ?in|admin|dashboard|edit|update|publish|draft|product|landing page|homepage|theme|inventory|upload|attach|import|download|export)\b/i.test(text)
  ) score += 2;
  if (pipeline.id === 'website_platform_admin' && /\b(upload|attach|import|download|export)\b/i.test(text) && /\b(file|image|photo|csv|pdf|spreadsheet|desktop|downloads?)\b/i.test(text)) score += 2;
  if (pipeline.id === 'website_platform_admin' && /\b(wordpress|wp admin)\b/i.test(text)) score -= 5;
  if (pipeline.id === 'browser_form_submission' && /\b(shopify|webflow|wix|squarespace|woocommerce|bigcommerce|framer|godaddy|site builder|website builder|store admin)\b/i.test(text)) score -= 1;
  if (pipeline.id === 'content_generation' && /\bwordpress|wp admin|publish|schedule\b/i.test(text)) score -= 4;
  if (pipeline.id === 'security_privacy' && /\b(api keys?|secure|not shared|privacy|rls|secrets?)\b/i.test(text)) score += 3;
  if (pipeline.id === 'coding_build' && /\b(security|secure|api keys?|charges?|cost|cron)\b/i.test(text)) score -= 2;
  if (pipeline.id === 'coding_build' && /\b(build|implementation plan|implement)\b/i.test(text)) score += 2;
  if (pipeline.id === 'code_review' && /\breview\b/i.test(text) && /\b(slow|cost|usage|fix|optimi[sz]e|ready|audit)\b/i.test(text)) score += 2;
  if (pipeline.id === 'performance_cost' && /\b(charges?|api usage|tokens?|cost|slow|latency)\b/i.test(text)) score += 3;
  if (pipeline.id === 'performance_cost' && /\b(set up|create|add|make)\b.*\b(cron|schedule|recurring)\b/i.test(text)) score -= 2;
  if (pipeline.id === 'direct_answer' && /\b(charges?|api usage|cost|slow|cron|secure|security|error|fix|debug)\b/i.test(text)) score -= 2;
  if (pipeline.id === 'schedule_automation' && /\b(cron|daily|weekly|recurring|schedule|background job)\b/i.test(text)) score += 3;
  if (pipeline.id === 'schedule_automation' && /\b(set up|create|add|make|automate)\b/i.test(text)) score += 2;
  if (pipeline.id === 'schedule_automation' && /\b(meeting|calendar|invite|email|appointment)\b/i.test(text)) score -= 2;
  if (pipeline.id === 'customer_support_crm' && /\b(ticket|support|customer|help ?desk|crm|case|inbox)\b/i.test(text)) score += 3;
  if (pipeline.id === 'customer_support_crm' && /\b(send|close|refund|change account)\b/i.test(text)) score += 1;
  if (pipeline.id === 'sales_leads_outreach' && /\b(leads?|prospects?|outreach|sales pipeline|crm|proposal)\b/i.test(text)) score += 3;
  if (pipeline.id === 'sales_leads_outreach' && /\b(send|sequence|email|add to crm|enroll)\b/i.test(text)) score += 1;
  if (pipeline.id === 'analytics_reporting' && /\b(analytics|metrics?|kpis?|dashboard|report|chart|trend|conversion|revenue)\b/i.test(text)) score += 3;
  if (pipeline.id === 'analytics_reporting' && /\b(csv|spreadsheet|excel|database|rows?|columns?)\b/i.test(text)) score += 1;
  if (pipeline.id === 'meetings_calendar_email' && /\b(meeting|calendar|invite|appointment|availability|email|recap)\b/i.test(text)) score += 3;
  if (pipeline.id === 'meetings_calendar_email' && /\b(cron|background job|daily research|wordpress|blog post)\b/i.test(text)) score -= 2;
  if (pipeline.id === 'data_import_export' && /\b(csv|spreadsheet|excel|google sheets|rows?|columns?|table|database|records?|etl)\b/i.test(text)) score += 3;
  if (pipeline.id === 'data_import_export' && /\b(import|export|upload|download|sync|migrate|map|clean|dedupe|normalize)\b/i.test(text)) score += 2;
  if (pipeline.id === 'data_import_export' && /\b(export|download)\b.*\b(exceptions?|records?|rows?|csv|report|data)\b/i.test(text)) score += 2;
  if (pipeline.id === 'data_import_export' && URL_RE.test(text) && /\b(extract|scrape|crawl|website|page)\b/i.test(text)) score -= 2;
  if (pipeline.id === 'finance_billing' && /\b(invoice|receipt|payment|billing|stripe|quickbooks|expense|refund|subscription|reconcile)\b/i.test(text)) score += 3;
  if (pipeline.id === 'finance_billing' && /\b(anthropic|openai|api|tokens?|model|usage)\b/i.test(text)) score -= 4;
  if (pipeline.id === 'document_intelligence' && /\b(pdf|document|contract|receipt|invoice|attachment|scan|ocr|docx)\b/i.test(text)) score += 5;
  if (pipeline.id === 'document_intelligence' && /\b(fill|complete|submit|signup|register|create|send|pay|refund|schedule|campaign|employee|new hire)\b/i.test(text)) score -= 3;
  if (pipeline.id === 'qa_testing' && /\b(qa|tests?|verify|reproduce|regression|e2e|playwright|cypress|acceptance)\b/i.test(text)) score += 4;
  if (pipeline.id === 'qa_testing' && /\b(create task|ticket|support|employee|customer support)\b/i.test(text)) score -= 2;
  if (pipeline.id === 'browser_form_submission' && /\b(qa|tests?|verify|reproduce|regression|e2e|playwright|cypress|acceptance)\b/i.test(text)) score -= 2;
  if (pipeline.id === 'it_support_ops' && /\b(it support|service ?now|jira|slack|help desk|access request|provision|deprovision|password reset|device|incident|on-call|app access)\b/i.test(text)) score += 5;
  if (pipeline.id === 'it_support_ops' && /\b(customer|prospect|lead|marketing|campaign)\b/i.test(text)) score -= 2;
  if (pipeline.id === 'compliance_monitoring' && /\b(compliance|regulatory|policy|audit|soc 2|hipaa|gdpr|pci|legal|risk control|evidence|security questionnaire)\b/i.test(text)) score += 5;
  if (pipeline.id === 'hr_onboarding' && /\b(hr|people ops|new hire|onboarding|offboarding|employee|welcome packet|first day|training plan)\b/i.test(text)) score += 3;
  if (pipeline.id === 'hr_onboarding' && /\b(customer|support|lead|prospect)\b/i.test(text)) score -= 2;
  if (pipeline.id === 'marketing_campaigns' && /\b(marketing|campaign|newsletter|seo|ads?|social posts?|content calendar|audience|segment|a\/b test)\b/i.test(text)) score += 3;
  if (pipeline.id === 'marketing_campaigns' && /\b(invoice|payment|support ticket|new hire|it support)\b/i.test(text)) score -= 2;
  if (pipeline.id === 'workflow_recording_replay' && /\b(record|capture|save|replay|rerun|repeat|workflow|steps|automation template|macro)\b/i.test(text)) score += 5;
  if (pipeline.id === 'qa_testing' && /\b(bugs?|failures?|failed|pass\/fail|screenshots?)\b/i.test(text)) score += 2;
  if (pipeline.id === 'workflow_recording_replay' && /\b(audio recording|video recording|voice memo)\b/i.test(text)) score -= 3;
  if (pipeline.id === 'adobe_creative_cloud' && ADOBE_CC_APP_RE.test(text)) score += 5;
  if (pipeline.id === 'adobe_creative_cloud' && ADOBE_CC_FILE_RE.test(text)) score += 4;
  if (pipeline.id === 'adobe_creative_cloud' && /\b(adobe|creative\s+cloud)\b/i.test(text) && /\b(open|launch|edit|change|update|create|make|export|render|encode|proof|automate)\b/i.test(text)) score += 2;
  if (pipeline.id === 'adobe_creative_cloud' && ADOBE_CORE_SCRIPTED_RE.test(text)) score -= 5;
  if (pipeline.id === 'travel_booking' && /\b(travel|trip|flight|hotel|airbnb|rental car|reservation|itinerary|restaurant|booking|tickets?)\b/i.test(text)) score += 5;
  if (pipeline.id === 'travel_booking' && /\b(book|reserve|cancel|change|check[- ]?in|seat)\b/i.test(text)) score += 2;
  if (pipeline.id === 'travel_booking' && /\b(support tickets?|customer|help ?desk|jira ticket|service ?now)\b/i.test(text)) score -= 5;
  if (pipeline.id === 'procurement_shopping' && /\b(procurement|purchase order|vendor|quote|reorder|buy|order|shopping cart|supplies|license|subscription purchase|shipment|delivery)\b/i.test(text)) score += 5;
  if (pipeline.id === 'procurement_shopping' && /\b(checkout|payment|return|refund|track)\b/i.test(text)) score += 2;
  if (pipeline.id === 'cloud_devops' && /\b(devops|ci\/cd|github actions|vercel|netlify|aws|gcp|azure|cloudflare|docker|kubernetes|terraform|deployment|incident|outage|logs?|uptime)\b/i.test(text)) score += 5;
  if (pipeline.id === 'cloud_devops' && /\b(deploy|rollback|restart|scale|tail|environment variables?|secrets?)\b/i.test(text)) score += 2;
  if (pipeline.id === 'cloud_devops' && /\b(captcha|recaptcha|hcaptcha|turnstile|human verification|bot verification|not a robot|mfa|otp)\b/i.test(text)) score -= 5;
  if (pipeline.id === 'cloud_devops' && /\b(shopify|webflow|wix|squarespace|woocommerce|bigcommerce|framer|godaddy|site builder|website builder|store admin)\b/i.test(text)) score -= 4;
  if (pipeline.id === 'social_community' && /\b(social media|community|comments?|dms?|discord|reddit|twitter|linkedin|instagram|facebook|mentions|followers?)\b/i.test(text)) score += 5;
  if (pipeline.id === 'social_community' && /\b(moderate|reply|respond|schedule|post|sentiment|ban|delete)\b/i.test(text)) score += 2;
  if (pipeline.id === 'inbox_notifications' && /\b(inbox|unread emails?|notifications?|slack messages?|teams messages?|alerts?|mentions|daily digest|inbox zero)\b/i.test(text)) score += 5;
  if (pipeline.id === 'inbox_notifications' && /\b(triage|prioriti[sz]e|summari[sz]e|label|archive|route|clean up)\b/i.test(text)) score += 2;
  if (pipeline.id === 'learning_training' && /\b(teach me|learn|training|tutorial|course|lesson|study plan|quiz|flashcards|curriculum|workshop)\b/i.test(text)) score += 5;
  if (pipeline.id === 'learning_training' && /\b(create|build|generate|make|explain|practice)\b/i.test(text)) score += 1;
  if (pipeline.id === 'high_stakes_advice' && /\b(medical|doctor|symptom|diagnosis|medicine|medication|prescription|legal advice|lawyer|lawsuit|tax advice|investment advice|financial advice|insurance claim|safety risk|emergency|chest pain)\b/i.test(text)) score += 6;
  if (pipeline.id === 'high_stakes_advice' && /\b(invoice|billing|stripe|quickbooks|support ticket|customer support|campaign|training plan)\b/i.test(text)) score -= 4;
  if (pipeline.id === 'finance_billing' && /\b(tax advice|investment advice|financial advice|insurance claim)\b/i.test(text)) score -= 3;
  if (pipeline.id === 'content_generation' && /\b(travel|procurement|purchase|devops|cloud|social|community|inbox|notification|training|medical|legal|tax|investment)\b/i.test(text)) score -= 2;
  if (pipeline.id === 'tasks_missions' && /\b(create|add|make|open|file)\b.*\b(tasks?|todos?|tickets?|issues?|follow[- ]?up tasks?)\b/i.test(text)) score += 5;
  if (pipeline.id === 'tasks_missions' && /\b(follow[- ]?up tasks?|create tasks?|add tasks?|open issues?|file bugs?)\b/i.test(text)) score += 3;
  if (pipeline.id === 'content_generation' && /\b(draft|write|compose|reply|respond|email|proposal|recap|script|post)\b/i.test(text)) score += 5;
  if (pipeline.id === 'content_generation' && /\b(ticket|support|crm|lead|prospect|invoice|payment|calendar invite|meeting|campaign|newsletter|employee|new hire)\b/i.test(text)) score -= 2;
  if (pipeline.id === 'browser_form_submission' && /\b(ticket|support|crm|lead|prospect|invoice|payment|calendar invite|meeting|campaign|employee|new hire)\b/i.test(text)) score -= 1;
  if (pipeline.id === 'live_research' && /\b(cron|schedule|daily|weekly|recurring)\b/i.test(text)) score -= 2;
  if (pipeline.id === 'human_verification' && /\b(captcha|recaptcha|hcaptcha|turnstile|human verification|bot verification|cloudflare|mfa|otp)\b/i.test(text)) score += 3;
  if (pipeline.id === 'human_verification' && /\b(captcha|recaptcha|hcaptcha|turnstile|human verification|bot verification|not a robot|mfa|otp)\b/i.test(text)) score += 4;

  if (score <= 0) return null;
  const confidence = Math.max(0.35, Math.min(0.98, score / 9));
  return { pipeline, score, confidence, reasons };
}

export function rankUserTaskPipelines(
  message: string,
  opts: { limit?: number; includeFallback?: boolean } = {},
): UserTaskPipelineMatch[] {
  const matches = USER_TASK_PIPELINES
    .map((pipeline) => scorePipeline(message, pipeline))
    .filter((match): match is UserTaskPipelineMatch => !!match)
    .sort((a, b) => (
      b.score - a.score ||
      (PIPELINE_TIEBREAK_PRIORITY[b.pipeline.id] || 0) - (PIPELINE_TIEBREAK_PRIORITY[a.pipeline.id] || 0) ||
      a.pipeline.title.localeCompare(b.pipeline.title)
    ));

  const limit = opts.limit ?? 5;
  if (matches.length === 0 && opts.includeFallback) {
    const fallback = USER_TASK_PIPELINES.find((pipeline) => pipeline.id === 'direct_answer');
    if (fallback) return [{ pipeline: fallback, score: 0.5, confidence: 0.35, reasons: ['fallback'] }];
  }
  return matches.slice(0, limit);
}

export function getBestUserTaskPipeline(
  message: string,
  opts: { includeFallback?: boolean } = {},
): UserTaskPipelineMatch | null {
  return rankUserTaskPipelines(message, { limit: 1, includeFallback: opts.includeFallback })[0] || null;
}

export function summarizeUserTaskPipelineMatch(match: UserTaskPipelineMatch): UserTaskPipelineSummary {
  const executionRequirements = inferExecutionRequirements(match.pipeline);
  return {
    id: match.pipeline.id,
    title: match.pipeline.title,
    category: match.pipeline.category,
    routeId: match.pipeline.routeId,
    executionKind: match.pipeline.executionKind,
    risk: match.pipeline.risk,
    confidence: Number(match.confidence.toFixed(2)),
    recommendedTools: match.pipeline.recommendedTools.slice(0, 8),
    executionRequirements,
    solutionSteps: match.pipeline.solutionSteps,
    completionCriteria: match.pipeline.completionCriteria,
    approvalTriggers: match.pipeline.approvalTriggers,
    persistenceTargets: match.pipeline.persistenceTargets,
  };
}

const RISK_WEIGHT: Record<UserTaskPipelineRisk, number> = {
  safe: 0,
  review: 1,
  external_side_effect: 2,
  destructive: 3,
};

function maxRisk(items: UserTaskPipelineSummary[]): UserTaskPipelineRisk {
  return items.reduce<UserTaskPipelineRisk>((max, item) => (
    RISK_WEIGHT[item.risk] > RISK_WEIGHT[max] ? item.risk : max
  ), 'safe');
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}

function inferExecutionRequirements(pipeline: UserTaskPipelineDefinition): string[] {
  const inferred: string[] = [];
  if (pipeline.routeId === 'browser' || pipeline.preferredSurfaces.some((surface) => /browser|browserbase|playwright/.test(surface))) {
    inferred.push('Browser automation bridge/session available when the task requires live web interaction.');
  }
  if (pipeline.preferredSurfaces.some((surface) => /desktop|file|terminal/.test(surface))) {
    inferred.push('Local desktop bridge permissions available for local apps, files, terminal, or screen state.');
  }
  if (pipeline.preferredSurfaces.some((surface) => /vault/.test(surface)) || pipeline.recommendedTools.some((tool) => /vault|credential/.test(tool))) {
    inferred.push('Vault credential grant resolved without exposing raw secrets to model output.');
  }
  if (pipeline.preferredSurfaces.some((surface) => /integration|crm|calendar|social|finance|cloud/.test(surface))) {
    inferred.push('Required marketplace integration or user-owned API key connected for the target account.');
  }
  if (pipeline.executionKind === 'run_command_handler' && pipeline.routeId) {
    inferred.push(`Chat command route ${pipeline.routeId} is available and can persist the action result.`);
  }
  if (pipeline.risk === 'review') {
    inferred.push('Human review is available before sensitive or state-changing steps.');
  }
  if (pipeline.risk === 'external_side_effect' || pipeline.risk === 'destructive') {
    inferred.push('Explicit approval is required before external sends, writes, purchases, submissions, or destructive changes.');
  }
  if (pipeline.persistenceTargets.length > 0) {
    inferred.push(`Persistence target is ready: ${pipeline.persistenceTargets.slice(0, 4).join(', ')}.`);
  }
  return uniqueStrings([...(pipeline.executionRequirements || []), ...inferred]);
}

function buildOrchestrationSteps(primary: UserTaskPipelineSummary, supporting: UserTaskPipelineSummary[]): string[] {
  const all = [primary, ...supporting];
  if (all.length === 1) {
    return [
      `Use the ${primary.title} pipeline.`,
      ...primary.solutionSteps.slice(0, 3),
    ];
  }
  return [
    `Start with ${primary.title} as the controlling pipeline.`,
    ...supporting.map((item) => `Use ${item.title} as a supporting pipeline when its surface is needed.`),
    'Do read-only discovery before write actions.',
    'Pause for approval before credential use, browser submission, desktop mutation, publishing, or destructive operations.',
  ];
}

function chooseExecutionPattern(items: UserTaskPipelineSummary[], ambiguous: boolean): UserTaskPipelineExecutionPattern {
  if (items.some((item) => item.risk === 'external_side_effect' || item.risk === 'destructive')) return 'human_review';
  if (items.some((item) => item.risk === 'review')) return 'human_review';
  if (items.length <= 1) return 'direct';
  const categories = new Set(items.map((item) => item.category));
  if (
    categories.has('code') && (categories.has('security') || categories.has('business') || categories.has('knowledge')) &&
    !ambiguous
  ) {
    return 'parallel';
  }
  return 'sequential';
}

export function buildUserTaskPipelineDecision(
  message: string,
  opts: { limit?: number; includeFallback?: boolean } = {},
): UserTaskPipelineDecision | null {
  const matches = rankUserTaskPipelines(message, {
    limit: Math.max(3, opts.limit ?? 5),
    includeFallback: opts.includeFallback ?? true,
  });
  const primaryMatch = matches[0];
  if (!primaryMatch) return null;

  const primary = summarizeUserTaskPipelineMatch(primaryMatch);
  const supportingMatches = matches
    .slice(1)
    .filter((match) => (
      match.confidence >= 0.5 ||
      primaryMatch.score - match.score <= 2.5 ||
      (
        primary.risk !== 'safe' &&
        match.pipeline.risk !== 'safe' &&
        primaryMatch.score - match.score <= 3.5
      )
    ))
    .slice(0, (opts.limit ?? 5) - 1);
  const supporting = supportingMatches.map(summarizeUserTaskPipelineMatch);
  const all = [primary, ...supporting];
  const second = supportingMatches[0];
  const ambiguous = Boolean(second && primaryMatch.score - second.score < 0.75 && primary.category !== second.pipeline.category);
  const aggregateRisk = maxRisk(all);
  const confidence = Number(Math.max(0.35, Math.min(0.98, primaryMatch.confidence - (ambiguous ? 0.08 : 0))).toFixed(2));
  const needsClarification = ambiguous && aggregateRisk !== 'safe';
  return {
    primary,
    supporting,
    pattern: chooseExecutionPattern(all, ambiguous),
    aggregateRisk,
    confidence,
    needsClarification,
    clarificationReason: needsClarification
      ? `The request matches multiple action surfaces: ${all.map((item) => item.title).join(', ')}.`
      : null,
    orchestrationSteps: buildOrchestrationSteps(primary, supporting),
    approvalTriggers: uniqueStrings(all.flatMap((item) => item.approvalTriggers)),
    persistenceTargets: uniqueStrings(all.flatMap((item) => item.persistenceTargets)),
    executionRequirements: uniqueStrings(all.flatMap((item) => item.executionRequirements)),
  };
}

export function buildUserTaskPipelinePromptBlock(message: string, opts: { limit?: number } = {}): string | null {
  const decision = buildUserTaskPipelineDecision(message, { limit: opts.limit ?? 3, includeFallback: true });
  if (!decision) return null;
  const recommendedTools = uniqueStrings([
    ...decision.primary.recommendedTools,
    ...decision.supporting.flatMap((item) => item.recommendedTools),
  ]).slice(0, 14);
  const lines = [
    '## User Task Pipeline',
    `Primary: ${decision.primary.title} (${decision.primary.id}) confidence=${decision.confidence.toFixed(2)} route=${decision.primary.routeId || 'chat'} execution=${decision.primary.executionKind}`,
    `Pattern: ${decision.pattern} risk=${decision.aggregateRisk}`,
    `Persistence targets: ${decision.persistenceTargets.join(', ') || 'chat_message'}`,
    `Recommended tools: ${recommendedTools.join(', ') || 'chat_history'}`,
  ];
  if (decision.executionRequirements.length > 0) {
    lines.push(`Execution requirements: ${decision.executionRequirements.join('; ')}`);
  }
  if (decision.supporting.length > 0) {
    lines.push(`Supporting: ${decision.supporting.map((item) => `${item.title} (${item.id})`).join(', ')}`);
  }
  lines.push('Orchestration:');
  for (const step of decision.orchestrationSteps) lines.push(`- ${step}`);
  lines.push(`Complete when: ${decision.primary.completionCriteria.join(' ')}`);
  if (decision.approvalTriggers.length) lines.push(`Approval triggers: ${decision.approvalTriggers.join('; ')}`);
  if (decision.needsClarification) lines.push(`Clarify before acting: ${decision.clarificationReason}`);
  lines.push('Use this pipeline decision as the operating runbook unless the user clearly asks for a different surface.');
  return lines.join('\n');
}
