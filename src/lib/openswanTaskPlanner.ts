import type { AgenticCodingProfile } from './agenticCodingProfile';

export type OpenSwanTaskKind = 'build' | 'review' | 'debug' | 'architect' | 'research' | 'automation' | 'general';
export type OpenSwanVerificationKind = 'typecheck' | 'tests' | 'lint' | 'preview' | 'manual_review' | 'security_review' | 'performance_review' | 'integration_review';
export type OpenSwanToolName =
  | 'workspace.create_room'
  | 'workspace.apply_artifacts'
  | 'workspace.open_preview'
  | 'browser.plan_task'
  | 'code.inspect'
  | 'code.generate'
  | 'code.review'
  | 'verification.typecheck'
  | 'verification.tests'
  | 'verification.lint'
  | 'verification.preview'
  | 'search_memories'
  | 'save_memory'
  | 'fetch_url'
  | 'list_circle_members'
  | 'schedule_action'
  | 'missions.list'
  | 'missions.create_task'
  | 'missions.complete_task'
  | 'github.list_repos'
  | 'github.read_file'
  | 'tasks.list'
  | 'tasks.get'
  | 'tasks.create'
  | 'tasks.update_status'
  | 'tasks.assign'
  | 'tasks.comment'
  | 'tasks.add_artifact'
  | 'goals.list'
  | 'goals.create'
  | 'goals.update_progress'
  | 'goals.update_status'
  | 'messages.list'
  | 'messages.create'
  | 'check_ins.list'
  | 'research.search'
  | 'research.save'
  | 'rooms.list'
  | 'rooms.create'
  | 'rooms.send_message'
  | 'rooms.list_tasks'
  | 'rooms.create_task'
  | 'rooms.create_file'
  | 'rooms.update_file'
  | 'rooms.list_files'
  | 'rooms.read_file'
  | 'integrations.list'
  | 'office.list_agents'
  | 'approvals.list'
  | 'approvals.request'
  | 'approvals.resolve';

export type OpenSwanVerificationCheck = {
  id: string;
  label: string;
  kind: OpenSwanVerificationKind;
  required: boolean;
  reason: string;
};

export type OpenSwanToolPlanItem = {
  tool: OpenSwanToolName;
  reason: string;
  priority: 'high' | 'medium' | 'low';
};

export type OpenSwanTaskPlan = {
  kind: OpenSwanTaskKind;
  profile: AgenticCodingProfile;
  summary: string;
  verification: OpenSwanVerificationCheck[];
  recommendedTools: OpenSwanToolPlanItem[];
};

const BUILD_RE = /\b(build|create|implement|ship|add|generate|make|write|code|component|screen|page|feature|endpoint|api|file)\b/i;
const REVIEW_RE = /\b(review|audit|assess|critique|look over|check|inspect|quality)\b/i;
const DEBUG_RE = /\b(debug|fix|broken|not working|error|bug|crash|exception|trace|regression)\b/i;
const ARCH_RE = /\b(architect|architecture|structure|boundary|pattern|dependency|design|refactor|split|modular)\b/i;
const RESEARCH_RE = /\b(research|compare|investigate|deep dive|tradeoff|best practice|options|approach)\b/i;
const AUTOMATION_RE = /\b(automate|workflow|task|pipeline|schedule|agent|orchestrate|runbook)\b/i;
const PREVIEW_RE = /\b(html|css|landing page|webpage|preview|ui|screen|room|sandbox)\b/i;
const BROWSER_RE = /\b(browser|website|web site|webpage|site|login|dashboard|click|fill|form|navigate|open url|browserbase|stagehand|computer[- ]use)\b/i;
const TEST_RE = /\b(tests?|specs?|coverage|assert|jest|vitest|playwright|cypress)\b/i;
const LINT_RE = /\b(lint|eslint|format|prettier)\b/i;
const SECURITY_RE = /\b(security|vulnerab|secret|auth|xss|injection|owasp)\b/i;
const PERF_RE = /\b(performance|slow|fast|latency|render|bundle|memory)\b/i;
const TASKS_RE = /\b(task|tasks|todo|to do|kanban|backlog|in progress|peer review|review|approved|done|assign)\b/i;
const GOALS_RE = /\b(goal|goals|okr|objective|key result|north star)\b/i;
const MISSIONS_RE = /\b(mission|missions|proof of work|pow)\b/i;
const MESSAGES_RE = /\b(chat|messages|message history|thread|conversation)\b/i;
const CHECKINS_RE = /\b(check-?in|check in|daily update|standup|streak)\b/i;
const RESEARCH_DOC_RE = /\b(research doc|research docs|research corpus|digest|findings|paper|report)\b/i;
const ROOMS_RE = /\b(room|rooms|workspace|project files|room files)\b/i;
const GITHUB_RE = /\b(github|repo|repository|branch|pull request|pr|read file)\b/i;
const INTEGRATIONS_RE = /\b(integration|integrations|connector|browserbase|figma|slack|teams|github app|provider)\b/i;
const OFFICE_RE = /\b(office agent|office agents|published agents|who is active|active agents|circle office)\b/i;
const APPROVAL_RE = /\b(approval|approvals|approve|approved|reject|rejected|needs approval|pending approval)\b/i;

function inferTaskKind(message: string, profile: AgenticCodingProfile): OpenSwanTaskKind {
  if (profile === 'review') return 'review';
  if (profile === 'debug') return 'debug';
  if (profile === 'architect') return 'architect';
  if (profile === 'research') return 'research';
  if (profile === 'design') return PREVIEW_RE.test(message) ? 'build' : 'architect';
  if (profile === 'support') return DEBUG_RE.test(message) ? 'debug' : 'general';
  if (profile === 'senior' && BUILD_RE.test(message)) return 'build';
  if (REVIEW_RE.test(message)) return 'review';
  if (DEBUG_RE.test(message)) return 'debug';
  if (ARCH_RE.test(message)) return 'architect';
  if (RESEARCH_RE.test(message)) return 'research';
  if (AUTOMATION_RE.test(message)) return 'automation';
  if (BUILD_RE.test(message)) return 'build';
  return 'general';
}

function buildVerification(
  kind: OpenSwanTaskKind,
  message: string,
  entities?: import('./messageEntityExtractor').MessageEntities,
): OpenSwanVerificationCheck[] {
  const checks: OpenSwanVerificationCheck[] = [];

  if (kind === 'build') {
    checks.push(
      { id: 'typecheck', label: 'Typecheck changed code', kind: 'typecheck', required: true, reason: 'Generated or changed code should compile cleanly.' },
      { id: 'integration', label: 'Check integration boundaries', kind: 'integration_review', required: true, reason: 'New code should fit current app architecture.' },
    );
    if (TEST_RE.test(message) || /feature|api|endpoint|logic|bug/i.test(message)) {
      checks.push({ id: 'tests', label: 'Run or define test coverage', kind: 'tests', required: true, reason: 'Behavioral changes need executable proof or test guidance.' });
    }
    if (PREVIEW_RE.test(message)) {
      checks.push({ id: 'preview', label: 'Preview generated UI in sandbox', kind: 'preview', required: true, reason: 'UI work should be validated visually.' });
    }
    if (LINT_RE.test(message) || /style|clean/i.test(message)) {
      checks.push({ id: 'lint', label: 'Check lint/format expectations', kind: 'lint', required: false, reason: 'Style issues should be caught before handoff.' });
    }
  }

  if (kind === 'review') {
    checks.push({ id: 'manual-review', label: 'Produce severity-ranked findings', kind: 'manual_review', required: true, reason: 'Review work must prioritize correctness and risk.' });
    checks.push({ id: 'integration-review', label: 'Check regressions and missing tests', kind: 'integration_review', required: true, reason: 'A strong review must call out integration gaps.' });
  }

  if (kind === 'debug') {
    checks.push({ id: 'root-cause', label: 'Identify likely root cause', kind: 'integration_review', required: true, reason: 'Debugging should not stop at symptom-level patches.' });
    checks.push({ id: 'tests', label: 'Define regression check', kind: 'tests', required: true, reason: 'Fixes should include a way to prove the issue stays fixed.' });
    if (entities?.stackTraces.length) {
      checks.push({ id: 'typecheck', label: 'Typecheck the likely fix path', kind: 'typecheck', required: true, reason: 'Stack traces usually imply code-path changes that should compile cleanly after the fix.' });
    }
  }

  if (kind === 'architect') {
    checks.push({ id: 'architecture', label: 'Review module boundaries and coupling', kind: 'integration_review', required: true, reason: 'Architecture work must evaluate long-term integration quality.' });
  }

  if (kind === 'research') {
    checks.push({ id: 'evidence', label: 'Ground conclusions in evidence', kind: 'manual_review', required: true, reason: 'Research work should distinguish findings from unsupported opinion.' });
    checks.push({ id: 'tradeoffs', label: 'State tradeoffs and recommendation', kind: 'integration_review', required: true, reason: 'Research should end in a decision-ready recommendation.' });
  }

  if (SECURITY_RE.test(message)) {
    checks.push({ id: 'security', label: 'Perform security review', kind: 'security_review', required: true, reason: 'Security-sensitive work needs explicit review.' });
  }

  if (PERF_RE.test(message)) {
    checks.push({ id: 'performance', label: 'Review likely performance impact', kind: 'performance_review', required: true, reason: 'Performance-sensitive work needs explicit validation.' });
  }

  if (checks.length === 0) {
    checks.push({ id: 'manual', label: 'Manual quality review', kind: 'manual_review', required: false, reason: 'General requests still benefit from a final quality pass.' });
  }

  const deduped = new Map<string, OpenSwanVerificationCheck>();
  for (const check of checks) {
    if (!deduped.has(check.kind)) deduped.set(check.kind, check);
  }
  return Array.from(deduped.values());
}

function buildRecommendedTools(kind: OpenSwanTaskKind, message: string, entities?: import('./messageEntityExtractor').MessageEntities): OpenSwanToolPlanItem[] {
  const tools: OpenSwanToolPlanItem[] = [
    { tool: 'code.inspect', reason: 'Inspect surrounding code and current context before acting.', priority: 'high' },
  ];

  if (kind === 'build' || kind === 'debug' || kind === 'architect') {
    tools.push({ tool: 'code.generate', reason: 'Produce concrete code or file artifacts for implementation work.', priority: 'high' });
  }
  if (kind === 'review') {
    tools.push({ tool: 'code.review', reason: 'Structure findings and quality analysis like a senior code reviewer.', priority: 'high' });
  }
  if (kind === 'research') {
    tools.push(
      { tool: 'research.search', reason: 'Search the research corpus for prior findings and synthesized knowledge.', priority: 'high' },
      { tool: 'fetch_url', reason: 'Pull in external pages or documentation when the question needs current evidence.', priority: 'high' },
      { tool: 'research.save', reason: 'Save durable findings when the research produces reusable knowledge.', priority: 'medium' },
    );
  }
  if (PREVIEW_RE.test(message)) {
    tools.push(
      { tool: 'workspace.create_room', reason: 'Create or use a room when the task benefits from file-backed iteration.', priority: 'high' },
      { tool: 'workspace.open_preview', reason: 'Open the generated output in a preview/sandbox for visual confirmation.', priority: 'high' },
    );
  }
  if (BROWSER_RE.test(message)) {
    tools.push({ tool: 'browser.plan_task', reason: 'Plan browser actions and pick the right execution backend before touching a live site.', priority: 'high' });
  }
  if (kind === 'build' || kind === 'debug') {
    tools.push(
      { tool: 'verification.typecheck', reason: 'Validate code integrity after changes.', priority: 'high' },
      { tool: 'verification.tests', reason: 'Use tests or regression checks to verify behavior.', priority: TEST_RE.test(message) ? 'high' : 'medium' },
    );
  }
  if (LINT_RE.test(message) || kind === 'architect') {
    tools.push({ tool: 'verification.lint', reason: 'Check consistency and static quality expectations.', priority: 'medium' });
  }
  if (PREVIEW_RE.test(message)) {
    tools.push({ tool: 'verification.preview', reason: 'Confirm UI results in a sandbox or preview.', priority: 'high' });
  }
  if (TASKS_RE.test(message) || /\b(my tasks|open tasks|create task|assign task)\b/i.test(message)) {
    tools.push(
      { tool: 'tasks.list', reason: 'Read the circle kanban state when the request is about active work.', priority: 'high' },
      { tool: 'tasks.create', reason: 'Create actionable work items when the user asks for new tasks.', priority: 'medium' },
      { tool: 'tasks.update_status', reason: 'Update task progress when the request implies moving work forward.', priority: 'medium' },
      { tool: 'tasks.assign', reason: 'Assign tasks to members when ownership is part of the request.', priority: 'medium' },
      { tool: 'tasks.comment', reason: 'Leave progress notes or review comments when the request is about updating a task conversation.', priority: 'medium' },
      { tool: 'tasks.add_artifact', reason: 'Attach deliverables or links to a task run when the work needs durable outputs.', priority: 'low' },
    );
  }
  if (GOALS_RE.test(message)) {
    tools.push(
      { tool: 'goals.list', reason: 'Load goal state before answering goal or OKR questions.', priority: 'high' },
      { tool: 'goals.create', reason: 'Create goals when the user is defining new outcomes.', priority: 'medium' },
      { tool: 'goals.update_progress', reason: 'Update measurable goal progress when the user provides new progress information.', priority: 'medium' },
      { tool: 'goals.update_status', reason: 'Change goal state when asked to activate, pause, or complete goals.', priority: 'medium' },
    );
  }
  if (MISSIONS_RE.test(message)) {
    tools.push(
      { tool: 'missions.list', reason: 'Surface mission progress and proof-of-work context.', priority: 'high' },
      { tool: 'missions.create_task', reason: 'Add mission tasks when a mission needs execution detail.', priority: 'medium' },
      { tool: 'missions.complete_task', reason: 'Close mission work when asked to mark it done.', priority: 'medium' },
    );
  }
  if (MESSAGES_RE.test(message)) {
    tools.push(
      { tool: 'messages.list', reason: 'Use recent message history when the user asks about chat context or thread activity.', priority: 'medium' },
      { tool: 'messages.create', reason: 'Post a chat message when the user explicitly wants OpenSwan to say or announce something in-circle.', priority: 'medium' },
    );
  }
  if (CHECKINS_RE.test(message)) {
    tools.push({ tool: 'check_ins.list', reason: 'Use recent check-ins when the request is about updates, momentum, or standups.', priority: 'medium' });
  }
  if (RESEARCH_DOC_RE.test(message) || kind === 'research') {
    tools.push(
      { tool: 'research.search', reason: 'Search the curated research corpus when the question is knowledge-heavy.', priority: 'high' },
      { tool: 'fetch_url', reason: 'Fetch external sources when the request includes a URL or doc lookup.', priority: 'medium' },
    );
  }
  if (ROOMS_RE.test(message)) {
    tools.push(
      { tool: 'rooms.list', reason: 'List project rooms when the request is about room-backed work.', priority: 'medium' },
      { tool: 'rooms.create', reason: 'Create a room when the user wants a new project/workspace container.', priority: 'medium' },
      { tool: 'rooms.send_message', reason: 'Post into a room conversation when the user wants OpenSwan to communicate there.', priority: 'medium' },
      { tool: 'rooms.list_tasks', reason: 'Inspect room automation/task state when the request involves room task runners.', priority: 'medium' },
      { tool: 'rooms.create_task', reason: 'Create room tasks when the user wants automation or recurring room work.', priority: 'medium' },
      { tool: 'rooms.create_file', reason: 'Create workspace files when the request needs room-backed implementation artifacts.', priority: 'medium' },
      { tool: 'rooms.update_file', reason: 'Update existing workspace files when the request is about editing room content.', priority: 'medium' },
      { tool: 'rooms.list_files', reason: 'Inspect room files when the request references a room workspace.', priority: 'medium' },
      { tool: 'rooms.read_file', reason: 'Read specific room files when the answer depends on workspace contents.', priority: 'medium' },
    );
  }
  if (GITHUB_RE.test(message)) {
    tools.push(
      { tool: 'github.list_repos', reason: 'Load connected repositories when repo context matters.', priority: 'medium' },
      { tool: 'github.read_file', reason: 'Read repository files when the request references GitHub content.', priority: 'medium' },
    );
  }
  if (INTEGRATIONS_RE.test(message)) {
    tools.push({ tool: 'integrations.list', reason: 'Check connected providers and capabilities before claiming the app can act on external systems.', priority: 'medium' });
  }
  if (OFFICE_RE.test(message)) {
    tools.push({ tool: 'office.list_agents', reason: 'Load the live office roster when the request is about active agents or publishing state.', priority: 'medium' });
  }
  if (APPROVAL_RE.test(message)) {
    tools.push(
      { tool: 'approvals.list', reason: 'List pending approvals before discussing approval state or action.', priority: 'medium' },
      { tool: 'approvals.request', reason: 'Request an explicit approval when the user wants a gated step added to a run.', priority: 'low' },
      { tool: 'approvals.resolve', reason: 'Resolve an approval when the user explicitly approves or rejects something.', priority: 'low' },
    );
  }
  if (/\bremember|save this|make note|store this\b/i.test(message)) {
    tools.push({ tool: 'save_memory', reason: 'Persist explicit user instructions or decisions into memory when requested.', priority: 'medium' });
  }
  if (/\bremember|what do we know|previously|earlier|past decision\b/i.test(message)) {
    tools.push({ tool: 'search_memories', reason: 'Load prior memories when the user asks for retained context.', priority: 'medium' });
  }
  if (/\bteam|members|who can help|who's here\b/i.test(message)) {
    tools.push({ tool: 'list_circle_members', reason: 'List members when the request is about owners, collaborators, or assignment targets.', priority: 'medium' });
  }
  if (/\bschedule|queue|remind|automation|send later\b/i.test(message)) {
    tools.push({ tool: 'schedule_action', reason: 'Queue a follow-up action when the request includes reminder or automation intent.', priority: 'medium' });
  }

  // ── Entity-aware tool recommendations ─────────────────────────────────
  // If the caller extracted structured entities from the message, auto-add
  // relevant tools that the regex patterns above may have missed.
  if (entities) {
    if (entities.filePaths.length > 0) {
      tools.push({ tool: 'code.inspect', reason: `Message references ${entities.filePaths.length} file path(s) — inspect before acting.`, priority: 'high' });
    }
    if (entities.githubRefs.length > 0) {
      tools.push({ tool: 'github.read_file', reason: `Message references ${entities.githubRefs.length} GitHub ref(s) — load context.`, priority: 'high' });
      tools.push({ tool: 'github.list_repos', reason: 'Load repository context for GitHub references.', priority: 'medium' });
    }
    if (entities.urls.length > 0) {
      tools.push({ tool: 'fetch_url', reason: `Message includes ${entities.urls.length} URL(s) — fetch for context.`, priority: 'high' });
    }
    if (entities.stackTraces.length > 0) {
      tools.push({ tool: 'verification.typecheck', reason: 'Stack trace detected — verify code compiles after fix.', priority: 'high' });
      tools.push({ tool: 'verification.tests', reason: 'Stack trace detected — run tests to verify fix.', priority: 'high' });
    }
    if (entities.codeBlocks.length > 0) {
      tools.push({ tool: 'code.review', reason: `${entities.codeBlocks.length} code block(s) pasted — review and analyze.`, priority: 'high' });
    }
  }

  const deduped = new Map<OpenSwanToolName, OpenSwanToolPlanItem>();
  for (const item of tools) {
    if (!deduped.has(item.tool)) deduped.set(item.tool, item);
  }
  return Array.from(deduped.values());
}

export function buildOpenSwanTaskPlan(
  message: string,
  profile: AgenticCodingProfile,
  entities?: import('./messageEntityExtractor').MessageEntities,
): OpenSwanTaskPlan {
  const kind = inferTaskKind(message, profile);
  return {
    kind,
    profile,
    summary: `${kind.toUpperCase()} task in ${profile.toUpperCase()} mode`,
    verification: buildVerification(kind, message, entities),
    recommendedTools: buildRecommendedTools(kind, message, entities),
  };
}
