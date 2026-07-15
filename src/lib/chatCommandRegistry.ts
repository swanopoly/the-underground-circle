export type ChatSlashCommandCategory =
  | 'general'
  | 'memory'
  | 'missions'
  | 'rooms'
  | 'github'
  | 'wordpress'
  | 'ai_tools'
  | 'governance'
  | 'vault'
  | 'knowledge';

export type ChatCommandRouteId =
  | 'help'
  | 'summary'
  | 'schedule'
  | 'mission'
  | 'room'
  | 'github'
  | 'wordpress'
  | 'browser'
  | 'build_page'
  | 'hf_tools'
  | 'local_knowledge'
  | 'memory'
  | 'governance'
  | 'vault'
  | 'search';

export type ChatCommandDecisionSource =
  | 'slash'
  | 'quick_action'
  | 'natural_language'
  | 'browser_suggestion'
  | 'system';

export interface ChatCommandDefinition {
  id: string;
  routeId: ChatCommandRouteId;
  command: string;
  insertText: string;
  title: string;
  description: string;
  category: ChatSlashCommandCategory;
  aliases?: string[];
  keywords?: string[];
  showInHelp?: boolean;
}

export interface ChatCommandExecutionMatch {
  routeId: ChatCommandRouteId;
  commandText: string;
}

export interface ChatCommandDecision {
  routeId: ChatCommandRouteId;
  source: ChatCommandDecisionSource;
  input: string;
  commandText: string;
  decidedAt: string;
}

const CATEGORY_LABELS: Record<ChatSlashCommandCategory, string> = {
  general: 'General',
  memory: 'Memory',
  missions: 'Missions',
  rooms: 'Rooms',
  github: 'GitHub',
  wordpress: 'WordPress',
  ai_tools: 'AI Tools',
  governance: 'Governance',
  vault: 'Vault',
  knowledge: 'Knowledge',
};

const HELP_CATEGORY_ORDER: ChatSlashCommandCategory[] = [
  'general',
  'knowledge',
  'memory',
  'missions',
  'rooms',
  'github',
  'wordpress',
  'ai_tools',
  'vault',
  'governance',
];

export const CHAT_COMMAND_REGISTRY: ChatCommandDefinition[] = [
  { id: 'help', routeId: 'help', command: '/help', insertText: '/help', title: 'Help', description: 'Show all available chat commands.', category: 'general', aliases: ['/commands'], keywords: ['commands', 'list'] },
  { id: 'summary', routeId: 'summary', command: '/summary', insertText: '/summary', title: 'Summary', description: 'Show the full circle status report.', category: 'general', aliases: ['/status'], keywords: ['report', 'circle', 'overview'] },
  { id: 'commands', routeId: 'help', command: '/commands', insertText: '/commands', title: 'Commands', description: 'Alias for command help.', category: 'general', aliases: ['/help'], keywords: ['help', 'list'] },
  { id: 'wiki', routeId: 'local_knowledge', command: '/wiki', insertText: '/wiki ', title: 'Wiki Search', description: 'Search the internal Wiki.', category: 'knowledge', keywords: ['knowledge', 'search', 'docs'] },
  { id: 'research', routeId: 'local_knowledge', command: '/research', insertText: '/research ', title: 'Research Corpus', description: 'Search the curated research corpus.', category: 'knowledge', keywords: ['science', 'papers', 'research'] },
  { id: 'memories', routeId: 'memory', command: '/memories', insertText: '/memories', title: 'Open Memories', description: 'Open the memory viewer.', category: 'memory', aliases: ['/memory'], keywords: ['viewer', 'saved'] },
  { id: 'schedule', routeId: 'schedule', command: '/schedule', insertText: '/schedule ', title: 'Schedule Action', description: 'Open the scheduler form (or pass `<kind> <text>` for CLI shortcut).', category: 'general', keywords: ['cron', 'queue', 'recurring', 'form'] },
  { id: 'cron', routeId: 'schedule', command: '/cron', insertText: '/cron', title: 'Scheduled Actions', description: 'List or manage scheduled actions.', category: 'general', aliases: ['/cron list'], keywords: ['schedule', 'jobs', 'recurring'] },
  { id: 'remember', routeId: 'memory', command: '/remember', insertText: '/remember ', title: 'Remember', description: 'Save something to memory.', category: 'memory', keywords: ['save', 'store'] },
  { id: 'forget', routeId: 'memory', command: '/forget', insertText: '/forget ', title: 'Forget', description: 'Delete memories matching a keyword.', category: 'memory', keywords: ['delete', 'remove'] },
  { id: 'reasoning-standard', routeId: 'memory', command: '/reasoning-standard', insertText: '/reasoning-standard', title: 'Reasoning Standard', description: 'Save your deep reasoning preference.', category: 'memory', aliases: ['/deep-reasoning'], keywords: ['reasoning', 'preference', 'depth'] },
  { id: 'memory-bank', routeId: 'memory', command: '/memory-bank', insertText: '/memory-bank', title: 'Memory Bank', description: 'Circle-scoped brief / active context / progress docs.', category: 'memory', aliases: ['/mb'], keywords: ['brief', 'context', 'progress', 'docs', 'bank'] },
  { id: 'memory-bank-update', routeId: 'memory', command: '/memory-bank update', insertText: '/memory-bank update ', title: 'Update Memory Doc', description: 'Write one of the three named docs (brief / active / progress).', category: 'memory', keywords: ['write', 'replace', 'save'] },
  { id: 'memory-bank-append', routeId: 'memory', command: '/memory-bank append', insertText: '/memory-bank append ', title: 'Append to Memory Doc', description: 'Append text to one of the three named docs.', category: 'memory', keywords: ['add', 'append'] },
  { id: 'mission', routeId: 'mission', command: '/mission', insertText: '/mission', title: 'Mission Status', description: 'Show mission status and progress.', category: 'missions', keywords: ['tasks', 'goals'] },
  { id: 'mission-status', routeId: 'mission', command: '/mission status', insertText: '/mission status', title: 'Mission Report', description: 'Show a detailed mission report.', category: 'missions', keywords: ['progress', 'report'] },
  { id: 'mission-create', routeId: 'mission', command: '/mission create', insertText: '/mission create ', title: 'Create Mission', description: 'Open the mission form, title pre-filled.', category: 'missions', keywords: ['new', 'goal', 'form'] },
  { id: 'mission-complete', routeId: 'mission', command: '/mission complete', insertText: '/mission complete', title: 'Complete Mission', description: 'Mark the latest mission complete.', category: 'missions', keywords: ['done', 'finish'] },
  { id: 'mission-help', routeId: 'mission', command: '/mission help', insertText: '/mission help', title: 'Mission Help', description: 'Show mission command help.', category: 'missions', keywords: ['docs', 'guide'] },
  // /task new <title> — intercepted in ChatTab's sendMessage. No dedicated
  // route; reuses the 'mission' route for discoverability since tasks live
  // inside the same mission-loop surface.
  { id: 'task-new', routeId: 'mission', command: '/task new', insertText: '/task new ', title: 'New Task', description: 'Open the task form with a title pre-filled.', category: 'missions', aliases: ['/task create', '/task add'], keywords: ['task', 'kanban', 'todo'] },
  { id: 'room', routeId: 'room', command: '/room', insertText: '/room ', title: 'Room Command', description: 'Run a room command.', category: 'rooms', keywords: ['files', 'project'] },
  { id: 'room-list', routeId: 'room', command: '/room list', insertText: '/room list', title: 'List Rooms', description: 'List project rooms.', category: 'rooms', keywords: ['projects', 'rooms'] },
  { id: 'room-ls', routeId: 'room', command: '/room ls', insertText: '/room ls', title: 'List Rooms Alias', description: 'Alias for listing rooms.', category: 'rooms', keywords: ['list', 'rooms'] },
  { id: 'room-files', routeId: 'room', command: '/room files', insertText: '/room files ', title: 'List Room Files', description: 'List files in a room.', category: 'rooms', keywords: ['browse', 'files'] },
  { id: 'room-read', routeId: 'room', command: '/room read', insertText: '/room read ', title: 'Read Room File', description: 'Alias for reading a room file.', category: 'rooms', keywords: ['cat', 'show', 'file'] },
  { id: 'room-show', routeId: 'room', command: '/room show', insertText: '/room show ', title: 'Show Room File', description: 'Alias for showing a room file.', category: 'rooms', keywords: ['cat', 'read', 'file'] },
  { id: 'room-cat', routeId: 'room', command: '/room cat', insertText: '/room cat ', title: 'Read Room File', description: 'Show room file contents.', category: 'rooms', keywords: ['read', 'show', 'file'] },
  { id: 'room-help', routeId: 'room', command: '/room help', insertText: '/room help', title: 'Room Help', description: 'Show room command help.', category: 'rooms', keywords: ['docs', 'guide'] },
  { id: 'gh', routeId: 'github', command: '/gh', insertText: '/gh ', title: 'GitHub Command', description: 'Run a GitHub command.', category: 'github', keywords: ['repo', 'pull request', 'code'] },
  { id: 'gh-status', routeId: 'github', command: '/gh status', insertText: '/gh status', title: 'GitHub Status', description: 'Show connected repos and activity.', category: 'github', keywords: ['repos', 'activity'] },
  { id: 'gh-tree', routeId: 'github', command: '/gh tree', insertText: '/gh tree', title: 'Repo Tree', description: 'Show the repo file tree.', category: 'github', keywords: ['files', 'tree'] },
  { id: 'gh-cat', routeId: 'github', command: '/gh cat', insertText: '/gh cat ', title: 'Read GitHub File', description: 'Show file contents from the repo.', category: 'github', keywords: ['read', 'file'] },
  { id: 'gh-edit', routeId: 'github', command: '/gh edit', insertText: '/gh edit ', title: 'Edit GitHub File', description: 'Start editing a repo file.', category: 'github', keywords: ['file', 'modify'] },
  { id: 'gh-save', routeId: 'github', command: '/gh save', insertText: '/gh save ', title: 'Save GitHub File', description: 'Save or create a repo file.', category: 'github', keywords: ['file', 'create', 'write'] },
  { id: 'gh-branch', routeId: 'github', command: '/gh branch', insertText: '/gh branch ', title: 'Create Branch', description: 'Create a new branch.', category: 'github', keywords: ['git', 'branch'] },
  { id: 'gh-branches', routeId: 'github', command: '/gh branches', insertText: '/gh branches', title: 'List Branches', description: 'List repo branches.', category: 'github', keywords: ['git', 'branch', 'list'] },
  { id: 'gh-pr', routeId: 'github', command: '/gh pr', insertText: '/gh pr ', title: 'Create Pull Request', description: 'Create a pull request.', category: 'github', keywords: ['pull request', 'review'] },
  { id: 'gh-commits', routeId: 'github', command: '/gh commits', insertText: '/gh commits', title: 'Recent Commits', description: 'List recent commits.', category: 'github', keywords: ['history', 'changes'] },
  { id: 'gh-diff', routeId: 'github', command: '/gh diff', insertText: '/gh diff ', title: 'Compare Branches', description: 'Compare two branches.', category: 'github', keywords: ['compare', 'changes'] },
  { id: 'gh-prs', routeId: 'github', command: '/gh prs', insertText: '/gh prs', title: 'Pull Requests', description: 'List open pull requests.', category: 'github', keywords: ['pr', 'review'] },
  { id: 'gh-help', routeId: 'github', command: '/gh help', insertText: '/gh help', title: 'GitHub Help', description: 'Show GitHub command help.', category: 'github', keywords: ['docs', 'guide'] },
  { id: 'wp', routeId: 'wordpress', command: '/wp', insertText: '/wp ', title: 'WordPress Command', description: 'Run a WordPress command.', category: 'wordpress', keywords: ['cms', 'publish', 'site'] },
  { id: 'wp-status', routeId: 'wordpress', command: '/wp status', insertText: '/wp status', title: 'WordPress Status', description: 'Show WordPress site connection status.', category: 'wordpress', keywords: ['site', 'connected'] },
  { id: 'wp-info', routeId: 'wordpress', command: '/wp info', insertText: '/wp info', title: 'WordPress Site Info', description: 'Alias for WordPress status.', category: 'wordpress', keywords: ['status', 'site'] },
  { id: 'wp-list', routeId: 'wordpress', command: '/wp list', insertText: '/wp list', title: 'List WordPress Posts', description: 'List recent posts.', category: 'wordpress', keywords: ['posts', 'content'] },
  { id: 'wp-pages', routeId: 'wordpress', command: '/wp pages', insertText: '/wp pages', title: 'List WordPress Pages', description: 'List pages on the site.', category: 'wordpress', keywords: ['pages', 'content'] },
  { id: 'wp-get', routeId: 'wordpress', command: '/wp get', insertText: '/wp get ', title: 'Get WordPress Post', description: 'Fetch a post by ID.', category: 'wordpress', keywords: ['post', 'read'] },
  { id: 'wp-write', routeId: 'wordpress', command: '/wp write', insertText: '/wp write ', title: 'Write WordPress Post', description: 'Generate and draft a full blog post.', category: 'wordpress', keywords: ['blog', 'draft', 'content'] },
  { id: 'wp-draft', routeId: 'wordpress', command: '/wp draft', insertText: '/wp draft ', title: 'Draft WordPress Post', description: 'Open the draft form (title, image, brief).', category: 'wordpress', keywords: ['post', 'draft', 'form'] },
  { id: 'wp-publish', routeId: 'wordpress', command: '/wp publish', insertText: '/wp publish ', title: 'Publish WordPress Post', description: 'Publish a drafted post.', category: 'wordpress', keywords: ['post', 'publish'] },
  { id: 'wp-schedule', routeId: 'wordpress', command: '/wp schedule', insertText: '/wp schedule ', title: 'Schedule WordPress Post', description: 'Schedule a post for later publishing.', category: 'wordpress', keywords: ['publish', 'calendar'] },
  { id: 'wp-edit', routeId: 'wordpress', command: '/wp edit', insertText: '/wp edit ', title: 'Edit WordPress Post', description: 'Edit an existing post.', category: 'wordpress', keywords: ['post', 'update'] },
  { id: 'wp-delete', routeId: 'wordpress', command: '/wp delete', insertText: '/wp delete ', title: 'Delete WordPress Post', description: 'Move a post to trash.', category: 'wordpress', keywords: ['trash', 'remove'] },
  { id: 'wp-image', routeId: 'wordpress', command: '/wp image', insertText: '/wp image ', title: 'Set Featured Image', description: 'Set a post featured image.', category: 'wordpress', keywords: ['featured', 'media'] },
  { id: 'wp-categories', routeId: 'wordpress', command: '/wp categories', insertText: '/wp categories', title: 'List Categories', description: 'List WordPress categories.', category: 'wordpress', keywords: ['taxonomy', 'content'] },
  { id: 'wp-tags', routeId: 'wordpress', command: '/wp tags', insertText: '/wp tags', title: 'List Tags', description: 'List WordPress tags.', category: 'wordpress', keywords: ['taxonomy', 'content'] },
  { id: 'wp-help', routeId: 'wordpress', command: '/wp help', insertText: '/wp help', title: 'WordPress Help', description: 'Show WordPress command help.', category: 'wordpress', keywords: ['docs', 'guide'] },
  { id: 'run', routeId: 'browser', command: '/run', insertText: '/run ', title: 'Run Command', description: 'Run a shell command via the Claude Code bridge and post the output to chat.', category: 'ai_tools', keywords: ['shell', 'bash', 'execute', 'terminal', 'test', 'lint', 'build'] },
  { id: 'vault', routeId: 'vault', command: '/vault', insertText: '/vault', title: 'Vault Status', description: 'Show vault readiness summary.', category: 'vault', keywords: ['credentials', 'secrets', 'passwords'] },
  { id: 'vault-list', routeId: 'vault', command: '/vault list', insertText: '/vault list', title: 'List Vault', description: 'List every credential in the circle vault.', category: 'vault', aliases: ['/vault ls'], keywords: ['credentials', 'list', 'all'] },
  { id: 'vault-find', routeId: 'vault', command: '/vault find', insertText: '/vault find ', title: 'Find Credential', description: 'Search the vault by platform / label / username / URL.', category: 'vault', aliases: ['/vault search'], keywords: ['search', 'lookup', 'credential'] },
  { id: 'vault-grants', routeId: 'vault', command: '/vault grants', insertText: '/vault grants ', title: 'Vault Grants', description: 'Show which agents or runtimes can use saved credentials.', category: 'vault', aliases: ['/vault access'], keywords: ['agent', 'access', 'permissions', 'openswan'] },
  { id: 'vault-grant', routeId: 'vault', command: '/vault grant', insertText: '/vault grant  to openswan actions=login', title: 'Grant Vault Access', description: 'Give OpenSwan, chat, an agent, or a member scoped automation access.', category: 'vault', keywords: ['agent', 'access', 'allow', 'credential'] },
  { id: 'vault-revoke', routeId: 'vault', command: '/vault revoke', insertText: '/vault revoke  from openswan', title: 'Revoke Vault Access', description: 'Remove an agent or runtime credential grant.', category: 'vault', keywords: ['agent', 'access', 'remove', 'credential'] },
  { id: 'vault-runbook', routeId: 'vault', command: '/vault runbook', insertText: '/vault runbook ', title: 'Vault Runbook', description: 'Generate safe agent instructions for a saved login without exposing the secret.', category: 'vault', keywords: ['agent', 'automation', 'login', 'runbook'] },
  { id: 'vault-resolve', routeId: 'vault', command: '/vault resolve', insertText: '/vault resolve ', title: 'Resolve Vault Credential', description: 'Find the best saved credential for a website automation task.', category: 'vault', keywords: ['agent', 'automation', 'website', 'login'] },
  { id: 'vault-status', routeId: 'vault', command: '/vault status', insertText: '/vault status', title: 'Vault Readiness', description: 'Show readiness counts (ready / needs test / rotation due).', category: 'vault', keywords: ['readiness', 'audit', 'health'] },
  { id: 'vault-rotation', routeId: 'vault', command: '/vault rotation', insertText: '/vault rotation', title: 'Rotation Due', description: 'List credentials whose rotation is overdue.', category: 'vault', aliases: ['/vault due'], keywords: ['expired', 'overdue', 'rotation'] },
  { id: 'vault-help', routeId: 'vault', command: '/vault help', insertText: '/vault help', title: 'Vault Help', description: 'Show vault command help.', category: 'vault', keywords: ['docs', 'guide'] },
  { id: 'browser', routeId: 'browser', command: '/browser', insertText: '/browser plan ', title: 'Computer Task', description: 'Plan and launch a computer task.', category: 'ai_tools', keywords: ['browser', 'computer', 'website', 'web', 'open', 'navigate'] },
  { id: 'browser-plan', routeId: 'browser', command: '/browser plan', insertText: '/browser plan ', title: 'Plan Computer Task', description: 'Plan a computer task from chat.', category: 'ai_tools', keywords: ['browser', 'computer', 'plan', 'website'] },
  { id: 'browser-open', routeId: 'browser', command: '/browser open', insertText: '/browser open ', title: 'Open In Browser', description: 'Open a site or page in the browser.', category: 'ai_tools', keywords: ['open', 'website', 'url', 'browse'] },
  { id: 'browser-extract', routeId: 'browser', command: '/browser extract', insertText: '/browser extract ', title: 'Extract From Site', description: 'Extract data from a webpage.', category: 'ai_tools', keywords: ['extract', 'scrape', 'site', 'page'] },
  { id: 'browser-screenshot', routeId: 'browser', command: '/browser screenshot', insertText: '/browser screenshot ', title: 'Screenshot Website', description: 'Capture a webpage screenshot.', category: 'ai_tools', keywords: ['screenshot', 'page', 'capture'] },
  // /watch — intercepted in ChatTab's sendMessage (recurring monitors). No
  // dedicated route; reuses the 'schedule' route for discoverability since
  // watches are scheduled re-runs of a read-only browser check.
  { id: 'watch', routeId: 'schedule', command: '/watch', insertText: '/watch ', title: 'Watch (recurring monitor)', description: 'Re-runs a read-only browser check on a schedule and reports only what changed. Usage: `/watch [hourly|daily|weekly] <task>`. Also: /watch list · /watch stop <n>.', category: 'ai_tools', keywords: ['monitor', 'recurring', 'hourly', 'daily', 'weekly', 'changes'] },
  { id: 'summarize', routeId: 'hf_tools', command: '/summarize', insertText: '/summarize ', title: 'Summarize', description: 'Summarize text or a URL.', category: 'ai_tools', keywords: ['summary', 'text'] },
  { id: 'translate', routeId: 'hf_tools', command: '/translate', insertText: '/translate ', title: 'Translate', description: 'Translate text.', category: 'ai_tools', keywords: ['language'] },
  { id: 'classify', routeId: 'hf_tools', command: '/classify', insertText: '/classify ', title: 'Classify', description: 'Classify text into categories.', category: 'ai_tools', keywords: ['labels'] },
  { id: 'zero-shot', routeId: 'hf_tools', command: '/zero-shot', insertText: '/zero-shot ', title: 'Zero Shot', description: 'Run zero-shot classification.', category: 'ai_tools', keywords: ['labels', 'classification'] },
  { id: 'qa', routeId: 'hf_tools', command: '/qa', insertText: '/qa ', title: 'Question Answering', description: 'Ask a question against provided context.', category: 'ai_tools', keywords: ['answer', 'context'] },
  { id: 'imagine', routeId: 'hf_tools', command: '/imagine', insertText: '/imagine ', title: 'Generate Image', description: 'Generate an image.', category: 'ai_tools', keywords: ['image', 'art'] },
  { id: 'vision', routeId: 'hf_tools', command: '/vision', insertText: '/vision ', title: 'Vision', description: 'Analyze an image or visual input.', category: 'ai_tools', keywords: ['image', 'analyze'] },
  { id: 'openmodel', routeId: 'hf_tools', command: '/openmodel', insertText: '/openmodel ', title: 'Open Model', description: 'Run a direct open-model prompt.', category: 'ai_tools', keywords: ['model'] },
  // /bestof — intercepted in ChatTab's sendMessage (best-of-N model race). No
  // dedicated route; reuses the 'hf_tools' route for discoverability since
  // races are text-only model generations.
  { id: 'bestof', routeId: 'hf_tools', command: '/bestof', insertText: '/bestof ', title: 'Best-of-N race', description: 'Races 2–4 models on the same task in parallel and judges the winner. Usage: `/bestof model1,model2 <task>`. Aliases: auto, sonnet, haiku, opus, gpt, blackswan.', category: 'ai_tools', aliases: ['/best-of-n'], keywords: ['race', 'models', 'compare', 'parallel', 'judge'] },
  // Intercepted in ChatTab's sendMessage BEFORE the planner (like /watch);
  // reuses the 'github' route for discoverability. Read-only: /review never
  // writes to GitHub.
  { id: 'review', routeId: 'github', command: '/review', insertText: '/review ', title: 'Code review', description: 'Reviews a pull request with the code-reviewer methodology (correctness → security → design → style; 🔴/🟡/💭 findings). Usage: `/review <pr-url | #123 | latest> [focus]`. Pasting a bare PR link also works.', category: 'ai_tools', keywords: ['pr', 'pull request', 'code review', 'diff', 'audit', 'security'] },
  // Universal creation entry — classifies the brief and re-dispatches to the
  // right existing pipeline (/build-page, /imagine, /task, /watch, WordPress,
  // CSV artifact, …). Intercepted in ChatTab before the planner.
  { id: 'create', routeId: 'hf_tools', command: '/create', insertText: '/create ', title: 'Create anything', description: 'One entry for making things: webpage, image, code, document, spreadsheet (CSV), WordPress post, task, recurring watch, automation. Usage: `/create <describe it>` — bare `/create` shows the menu.', category: 'ai_tools', aliases: ['/make'], keywords: ['make', 'new', 'generate', 'build', 'write', 'design'] },
  // /apps — the window into desktop/design/engineering app automation:
  // what chat can drive (docs/apps profiles) + a live reachability check
  // (bridge -> installed -> running -> focus -> a11y). Intercepted in ChatTab.
  { id: 'apps', routeId: 'hf_tools', command: '/apps', insertText: '/apps ', title: 'App automation status', description: 'See which desktop/design/engineering apps chat can automate, and check one live: `/apps` for the overview, `/apps photoshop` for details + a reachability check.', category: 'ai_tools', keywords: ['photoshop', 'cad', 'desktop', 'automation', 'reachable', 'blender', 'figma'] },
  // /integrations — connected API integrations: list them, get connect steps,
  // or `act <goal>` to have the agent compose an approval-gated API call
  // (custom_api.read/request tools). Intercepted in ChatTab (P30).
  { id: 'integrations', routeId: 'hf_tools', command: '/integrations', insertText: '/integrations ', title: 'Integrations', description: 'See connected integrations, get connect steps, or act: `/integrations` lists them, `/integrations connect linear` shows setup, `/integrations act create a Linear issue "Fix login"` composes the API call for your approval.', category: 'ai_tools', aliases: ['/integration'], keywords: ['api', 'connect', 'slack', 'linear', 'stripe', 'webhook', 'custom api', 'act'] },
  // /screen — one-tap observation of the frontmost (or named) app: state,
  // windows, what changed since the last look, suggested next step (P19).
  { id: 'screen', routeId: 'hf_tools', command: '/screen', insertText: '/screen ', title: "What's on my screen", description: 'Look at the frontmost app (or `/screen <app>`): running state, open windows, what changed since my last look, and a suggested next step.', category: 'ai_tools', keywords: ['observe', 'window', 'desktop', 'next step', 'look'] },
  // /context — the user-controlled context dial + transparency receipt.
  // Intercepted in ChatTab; policy lives in contextDepthPolicy.ts.
  { id: 'context', routeId: 'help', command: '/context', insertText: '/context ', title: 'Context depth', description: 'Control how much context I load each turn: `/context` shows the current setting + what I loaded last turn, `/context max` always loads everything (memory, sessions, missions, codebase), `/context lean` keeps turns fast, `/context standard` returns to automatic.', category: 'general', keywords: ['memory', 'context', 'depth', 'remember', 'full context', 'load everything', 'receipt'] },
  { id: 'build-page', routeId: 'build_page', command: '/build-page', insertText: '/build-page ', title: 'Build Page', description: 'Generate a webpage.', category: 'ai_tools', aliases: ['/build'], keywords: ['html', 'web'] },
  { id: 'code', routeId: 'hf_tools', command: '/code', insertText: '/code ', title: 'Code', description: 'Generate code from a prompt.', category: 'ai_tools', keywords: ['programming', 'build'] },
  { id: 'speak', routeId: 'hf_tools', command: '/speak', insertText: '/speak ', title: 'Speak', description: 'Convert text to speech.', category: 'ai_tools', keywords: ['audio', 'tts'] },
  { id: 'hf-help', routeId: 'hf_tools', command: '/hf help', insertText: '/hf help', title: 'AI Tools Help', description: 'Show AI tools help.', category: 'ai_tools', aliases: ['/hf'], keywords: ['hugging face', 'tools', 'guide'] },
  { id: 'vote', routeId: 'governance', command: '/vote', insertText: '/vote', title: 'Vote Alias', description: 'Alias for active proposals.', category: 'governance', aliases: ['/proposals'], keywords: ['proposal', 'poll'] },
  { id: 'votes', routeId: 'governance', command: '/votes', insertText: '/votes', title: 'Votes Alias', description: 'Alias for active proposals.', category: 'governance', aliases: ['/proposals'], keywords: ['proposal', 'poll'] },
  { id: 'poll', routeId: 'governance', command: '/poll', insertText: '/poll ', title: 'Create Poll', description: 'Open the poll form (question + 2–5 options).', category: 'governance', keywords: ['vote', 'proposal', 'form'] },
  { id: 'propose', routeId: 'governance', command: '/propose', insertText: '/propose ', title: 'Create Proposal', description: 'Open the proposal form (title + description).', category: 'governance', keywords: ['vote', 'dao', 'form'] },
  { id: 'proposals', routeId: 'governance', command: '/proposals', insertText: '/proposals', title: 'Active Proposals', description: 'Show active proposals and polls.', category: 'governance', aliases: ['/vote', '/votes'], keywords: ['governance', 'polls'] },
  { id: 'pin', routeId: 'governance', command: '/pin', insertText: '/pin', title: 'Pin Message', description: 'Pin the latest eligible message.', category: 'governance', keywords: ['important'] },
  { id: 'pins', routeId: 'governance', command: '/pins', insertText: '/pins', title: 'Pinned Messages', description: 'Show pinned messages.', category: 'governance', aliases: ['/pinned'], keywords: ['important'] },
  { id: 'search', routeId: 'search', command: '/search', insertText: '/search ', title: 'Search Chat', description: 'Search chat history.', category: 'governance', keywords: ['messages', 'history'] },
  { id: 'trace', routeId: 'governance', command: '/trace', insertText: '/trace ', title: 'Run Trace', description: 'Render a live trace card for a run by id (steps, status, errors).', category: 'governance', keywords: ['run', 'debug', 'steps', 'agent'] },
];

function commandMatchesInput(command: string, normalized: string): boolean {
  if (!normalized) return true;
  const haystack = command.toLowerCase().replace(/^[\\/]/, '');
  return haystack.includes(normalized);
}

export function getChatCommandCategoryLabel(category: ChatSlashCommandCategory): string {
  return CATEGORY_LABELS[category];
}

export function getChatCommandById(id: string): ChatCommandDefinition | null {
  return CHAT_COMMAND_REGISTRY.find((entry) => entry.id === id) || null;
}

export function getChatCommandByCommand(command: string): ChatCommandDefinition | null {
  const normalized = command.trim().toLowerCase();
  if (!normalized) return null;
  return CHAT_COMMAND_REGISTRY.find((entry) => (
    entry.command.toLowerCase() === normalized
    || (entry.aliases || []).some((alias) => alias.toLowerCase() === normalized)
  )) || null;
}

export function getChatCommandsForRoute(routeId: ChatCommandRouteId): ChatCommandDefinition[] {
  return CHAT_COMMAND_REGISTRY.filter((entry) => entry.routeId === routeId);
}

export function buildChatCommandHelpMessage(): string {
  const lines: string[] = ['**Available Commands**', ''];

  for (const category of HELP_CATEGORY_ORDER) {
    const commands = CHAT_COMMAND_REGISTRY
      .filter((entry) => entry.category === category && entry.showInHelp !== false)
      .filter((entry, index, arr) => arr.findIndex((candidate) => candidate.command === entry.command) === index);
    if (commands.length === 0) continue;
    lines.push(`**${CATEGORY_LABELS[category]}**`);
    for (const command of commands) {
      lines.push(`\`${command.command}\` — ${command.description}`);
    }
    lines.push('');
  }

  lines.push('**Tips**');
  lines.push('- Press `⌘K` / `Ctrl+K` for the omnibar — searches missions, tasks, goals, messages + fires any quick action by name.');
  lines.push('- Commands ending with a form (`/mission create`, `/task new`, `/poll`, `/propose`, `/schedule`, `/wp draft`) open a modal with pre-filled fields — no need to remember arg syntax.');
  lines.push('- OpenSwan modes are optional. Pick `Talk`, `Build`, `Plan`, `Review`, or another mode from the mode menu when you want the OpenSwan runtime.');
  return lines.join('\n');
}

export function getMatchingChatCommands(input: string): ChatCommandDefinition[] {
  const trimmed = input.trimStart();
  if (!trimmed.startsWith('/')) return [];
  const firstToken = trimmed.split(/\s+/, 1)[0] || '';
  if (!firstToken.startsWith('/')) return [];
  const normalizedQuery = firstToken.slice(1).toLowerCase().replace(/\s+/g, '');

  const matches = CHAT_COMMAND_REGISTRY.filter((entry) => {
    if (!normalizedQuery) return true;
    const haystacks = [
      entry.command,
      entry.title,
      entry.description,
      ...(entry.aliases || []),
      ...(entry.keywords || []),
    ];
    return haystacks.some((value) => commandMatchesInput(value, normalizedQuery));
  });

  return matches.sort((a, b) => {
    const aExact = a.command.slice(1).startsWith(normalizedQuery) ? 0 : 1;
    const bExact = b.command.slice(1).startsWith(normalizedQuery) ? 0 : 1;
    if (aExact !== bExact) return aExact - bExact;
    return a.command.localeCompare(b.command);
  });
}

export function matchesChatCommandRoute(input: string, routeId: ChatCommandRouteId): boolean {
  const normalized = input.trim().toLowerCase();
  if (!normalized.startsWith('/')) return false;
  return CHAT_COMMAND_REGISTRY
    .filter((entry) => entry.routeId === routeId)
    .some((entry) => {
      const candidates = [entry.command, ...(entry.aliases || [])].map((value) => value.toLowerCase());
      return candidates.some((candidate) => normalized === candidate || normalized.startsWith(`${candidate} `));
    });
}

export function inferChatCommandRoute(input: string): ChatCommandRouteId | null {
  const normalized = input.trim().toLowerCase();
  if (!normalized || normalized.startsWith('/')) return null;

  const scores = new Map<ChatCommandRouteId, number>();
  for (const entry of CHAT_COMMAND_REGISTRY) {
    const signals = [entry.title, entry.description, ...(entry.keywords || [])];
    for (const signal of signals) {
      const token = signal.toLowerCase();
      if (!token) continue;
      if (normalized.includes(token)) {
        scores.set(entry.routeId, (scores.get(entry.routeId) || 0) + Math.max(1, Math.min(3, token.split(/\s+/).length)));
      }
    }
  }

  const ranked = Array.from(scores.entries()).sort((a, b) => b[1] - a[1]);
  if (!ranked.length || ranked[0][1] < 2) return null;
  return ranked[0][0];
}

// "every/each <unit>" recurring cadence. A recurring request ("every morning
// post yesterday's merged PRs to Slack") must NOT be rewritten to a one-shot
// slash command (e.g. /gh prs) — the surrounding recurrence intent is the
// point. When this matches we return null so the request falls through to the
// planner's schedule lane (buildRecurringSchedulePlan). Anchored to a named
// time-unit/weekday so it never fires on non-cadence "every"/"each".
const INFER_RECURRING_CADENCE_RE = /\b(?:every|each)\s+(?:other\s+)?(?:morning|afternoon|evening|night|day|weekday|weekend|week|month|hour|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i;

export function inferChatCommandExecution(input: string): ChatCommandExecutionMatch | null {
  const normalized = input.trim();
  const lower = normalized.toLowerCase();
  if (!normalized || lower.startsWith('/')) return null;

  // Recurring cadence → never a one-shot rewrite; let the schedule lane own it.
  if (INFER_RECURRING_CADENCE_RE.test(normalized)) return null;

  if (/\b(use|open|launch|run|browse|visit|check|inspect|extract|screenshot|monitor)\b.*\bbrowser\b/i.test(normalized)) {
    const task = normalized
      .replace(/\b(use|open|launch|run)\b\s+(the\s+)?browser\s+to\s+/i, '')
      .replace(/\b(in|with)\s+(the\s+)?browser\b/i, '')
      .trim();
    return { routeId: 'browser', commandText: task ? `/browser plan ${task}` : '/browser plan ' };
  }
  if (/\b(open|browse|visit|go to|check)\b.*https?:\/\//i.test(normalized)) {
    const task = normalized.replace(/^\s*(open|browse|visit|go to|check)\s+/i, '').trim();
    return { routeId: 'browser', commandText: `/browser open ${task}` };
  }
  if (/\b(extract|scrape|pull)\b.*\b(from|on)\b.*\b(site|website|page|url)\b/i.test(normalized)) {
    const task = normalized.replace(/^\s*(extract|scrape|pull)\s+/i, '').trim();
    return { routeId: 'browser', commandText: `/browser extract ${task}` };
  }
  if (/\b(screenshot|capture)\b.*\b(site|website|page|url)\b/i.test(normalized)) {
    const task = normalized.replace(/^\s*(screenshot|capture)\s+/i, '').trim();
    return { routeId: 'browser', commandText: `/browser screenshot ${task}` };
  }
  if (/\b(search|look up|find)\b.*\bwiki\b/i.test(normalized)) {
    const query = normalized.replace(/\b(search|look up|find)\b.*\bwiki\b\s*/i, '').trim();
    return { routeId: 'local_knowledge', commandText: query ? `/wiki ${query}` : '/wiki ' };
  }
  if (/\b(search|look up|find|research)\b.*\b(research|corpus|papers|docs)\b/i.test(normalized)) {
    const query = normalized.replace(/\b(search|look up|find|research)\b.*\b(research|corpus|papers|docs)\b\s*/i, '').trim();
    return { routeId: 'local_knowledge', commandText: query ? `/research ${query}` : '/research ' };
  }
  if (/\b(repo tree|repository tree|file tree)\b/i.test(lower)) {
    return { routeId: 'github', commandText: '/gh tree' };
  }
  if (/\b(open pull requests|pull requests|prs)\b/i.test(lower)) {
    return { routeId: 'github', commandText: '/gh prs' };
  }
  if (/\brecent commits|commit history|commits\b/i.test(lower) && /\bgithub|repo|repository\b/i.test(lower)) {
    return { routeId: 'github', commandText: '/gh commits' };
  }
  if (/\bgithub|repo|repository\b/i.test(lower) && /\bstatus\b/i.test(lower)) {
    return { routeId: 'github', commandText: '/gh status' };
  }
  if (/\bmission\b/i.test(lower) && /\b(status|progress|report|active)\b/i.test(lower)) {
    return { routeId: 'mission', commandText: '/mission status' };
  }
  if (/\b(list|show)\b.*\brooms?\b/i.test(lower)) {
    return { routeId: 'room', commandText: '/room list' };
  }
  if (/\broom\b.*\bfiles?\b/i.test(lower)) {
    return { routeId: 'room', commandText: '/room files' };
  }
  // Intentionally NOT mapping "build <page/site/...>" to /build-page anymore.
  // Natural-language build intent must flow through the conversational
  // orchestrator (see src/lib/conversationalBuild.ts) so the bot can run a
  // discovery conversation first. Auto-rewriting to /build-page here would
  // short-circuit that flow and fire the build stream before the user has
  // had a chance to confirm scope. Users who want direct execution can
  // still type /build-page <brief> themselves.
  if (/\bsummarize\b/i.test(lower)) {
    return { routeId: 'hf_tools', commandText: `/summarize ${normalized.replace(/\bsummarize\b/i, '').trim()}`.trim() };
  }
  if (/\btranslate\b/i.test(lower)) {
    return { routeId: 'hf_tools', commandText: `/translate ${normalized.replace(/\btranslate\b/i, '').trim()}`.trim() };
  }

  return null;
}
