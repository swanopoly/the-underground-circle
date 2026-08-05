/**
 * agent-standards-wiki-smoketest
 *
 * Locks the app wiki coverage for canonical agent development standards.
 * Run after editing the standards docs or their wiki mirrors.
 *
 * Run: npm run smoke:agent-standards-wiki
 */

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  AGENT_DEVELOPMENT_STANDARD_DOCS,
  AGENT_DEVELOPMENT_TASK_ROUTES,
  applyAgentDevelopmentStandardsToPrompt,
  buildAgentWorktreeQualityChecklist,
  buildAgentWorktreeQualityPromptBlock,
  buildAgentDevelopmentStandardsPromptBlock,
  buildRelevantAgentDevelopmentStandardsPromptBlock,
  formatAgentWorktreeQualityChecklistPromptBlock,
  getAgentDevelopmentStandard,
  getStandardsForTaskType,
  inferAgentDevelopmentTaskRoute,
  resolveAgentDevelopmentTaskRoute,
  summarizeRelevantAgentDevelopmentStandards,
} from '../src/lib/agentDevelopmentStandards';
import {
  buildWikiKnowledgeBundle,
  buildWikiSearchResponse,
  getArticle,
  getWikiArticleBuilderPrompts,
  getWikiArticleLearningLoop,
  getWikiFuturePaths,
  getWikiResearchInsights,
  searchArticles,
} from '../src/lib/wikiData';

function assert(condition: unknown, label: string, detail?: string): void {
  if (!condition) {
    throw new Error(detail ? `${label}: ${detail}` : label);
  }
  console.log(`pass: ${label}`);
}

const repoRoot = resolve(__dirname, '..');

for (const doc of AGENT_DEVELOPMENT_STANDARD_DOCS) {
  const absolutePath = resolve(repoRoot, doc.docPath);
  assert(existsSync(absolutePath), `doc exists: ${doc.docPath}`);
  const content = readFileSync(absolutePath, 'utf8');
  for (const requiredText of doc.requiredDocSnippets) {
    assert(content.includes(requiredText), `doc ${doc.docPath} includes ${requiredText}`);
  }
}

function articleText(articleId: string): string {
  const article = getArticle(articleId);
  assert(article, `article exists: ${articleId}`);
  return [
    article?.title,
    article?.subtitle,
    article?.tags.join(' '),
    ...(article?.content ?? []).flatMap((section) => [
      section.title,
      section.content,
      section.codeExample ?? '',
      ...(section.bulletPoints ?? []),
      ...(section.tableData?.headers ?? []),
      ...(section.tableData?.rows.flat() ?? []),
    ]),
  ].filter(Boolean).join('\n');
}

for (const standard of AGENT_DEVELOPMENT_STANDARD_DOCS) {
  if (!standard.wikiArticleId) continue;

  const article = getArticle(standard.wikiArticleId);
  assert(article?.category === standard.wikiCategory, `article category: ${standard.wikiArticleId}`);

  for (const query of standard.articleSearchQueries ?? []) {
    const found = searchArticles(query).some((item) => item.id === standard.wikiArticleId);
    assert(found, `article searchable: ${standard.wikiArticleId} via "${query}"`);
  }

  const text = articleText(standard.wikiArticleId);
  for (const requiredText of standard.requiredArticleSnippets ?? []) {
    assert(text.includes(requiredText), `article ${standard.wikiArticleId} includes ${requiredText}`);
  }
}

const noMatchWikiResponse = buildWikiSearchResponse('zzzzzzzz-no-match');
const oldWikiLabel = ['Knowledge', 'Wiki'].join(' ');
assert(noMatchWikiResponse.includes('**Wiki Search:**'), 'wiki search no-match response uses Wiki label');
assert(!noMatchWikiResponse.includes(oldWikiLabel), 'wiki search no-match response omits old wiki label');

const matchedWikiResponse = buildWikiSearchResponse('MCP');
assert(matchedWikiResponse.includes('**Wiki Search: "MCP"**'), 'wiki search match response uses Wiki label');
assert(!matchedWikiResponse.includes(oldWikiLabel), 'wiki search match response omits old wiki label');

const noMatchWikiBundle = buildWikiKnowledgeBundle('zzzzzzzz-no-match');
assert(noMatchWikiBundle.includes('but the Wiki covers'), 'wiki knowledge bundle uses Wiki fallback label');
assert(!noMatchWikiBundle.includes(oldWikiLabel), 'wiki knowledge bundle omits old wiki label');

const futurePaths = getWikiFuturePaths();
assert(futurePaths.length >= 5, 'wiki future paths expose inspiration journeys');
for (const path of futurePaths) {
  assert(path.title.length > 0, `future path has title: ${path.id}`);
  assert(path.outcome.length > 0, `future path has outcome: ${path.id}`);
  assert(path.articleIds.some(articleId => Boolean(getArticle(articleId))), `future path has valid articles: ${path.id}`);
}

const researchInsights = getWikiResearchInsights();
assert(researchInsights.length >= 7, 'wiki research insights expose researched learning upgrades');
for (const insight of researchInsights) {
  assert(insight.sourceUrl.startsWith('https://'), `research insight has source url: ${insight.id}`);
  assert(insight.addToWiki.length > 0, `research insight has wiki action: ${insight.id}`);
  assert(insight.userAction.length > 0, `research insight has user action: ${insight.id}`);
}

const articleLearningLoop = getWikiArticleLearningLoop('future-cities-epcot-systems');
assert(articleLearningLoop.length === 4, 'wiki article learning loop exposes four learning passes');
assert(articleLearningLoop.some(item => item.label === 'Recall'), 'wiki article learning loop includes recall');
assert(articleLearningLoop.some(item => item.label === 'Transfer'), 'wiki article learning loop includes transfer');
assert(articleLearningLoop.some(item => item.label === 'Project'), 'wiki article learning loop includes project');
assert(articleLearningLoop.some(item => item.label === 'Future'), 'wiki article learning loop includes future');
assert(articleLearningLoop.every(item => item.sourceUrl.startsWith('https://')), 'wiki article learning loop keeps research source urls');

const builderPrompts = getWikiArticleBuilderPrompts('future-cities-epcot-systems');
assert(builderPrompts.length === 3, 'wiki article builder prompts expose imagine/build/question flow');
assert(builderPrompts.some(item => item.label === 'Imagine'), 'wiki article builder prompts include imagine prompt');
assert(builderPrompts.some(item => item.label === 'Build'), 'wiki article builder prompts include build prompt');
assert(builderPrompts.some(item => item.label === 'Question'), 'wiki article builder prompts include question prompt');
assert(builderPrompts.every(item => item.articleIds.includes('future-cities-epcot-systems')), 'wiki article builder prompts retain source article');

for (const route of AGENT_DEVELOPMENT_TASK_ROUTES) {
  const standards = getStandardsForTaskType(route.taskType);
  assert(standards.length === route.standardIds.length, `task route standards resolve: ${route.taskType}`);
  for (const id of route.standardIds) {
    assert(Boolean(getAgentDevelopmentStandard(id)), `standard id resolves: ${route.taskType} -> ${id}`);
  }
}

assert(resolveAgentDevelopmentTaskRoute('fix a TypeScript planner bug').taskType === 'typescript',
  'route resolver: TypeScript task');
assert(resolveAgentDevelopmentTaskRoute('build a responsive landing page').taskType === 'web_page',
  'route resolver: web page task');
assert(resolveAgentDevelopmentTaskRoute('update product design and automation UI').taskType === 'product_ui',
  'route resolver: product UI task');
assert(resolveAgentDevelopmentTaskRoute('build desktop app automation recovery for AutoCAD').taskType === 'computer_app_automation',
  'route resolver: computer app automation task');
assert(resolveAgentDevelopmentTaskRoute('open an InDesign file and change a marketing banner layer').taskType === 'computer_app_automation',
  'route resolver: InDesign app automation task');
assert(resolveAgentDevelopmentTaskRoute('add an MCP bridge tool contract with recovery evals and redaction').taskType === 'agent_tool_contracts',
  'route resolver: agent tool contract task');
assert(resolveAgentDevelopmentTaskRoute('update the standards wiki docs').taskType === 'standards_wiki',
  'route resolver: standards wiki task');
assert(inferAgentDevelopmentTaskRoute('normal conversation about lunch') === null,
  'inferred route: unrelated chat has no standards block');
assert(inferAgentDevelopmentTaskRoute('normal conversation', { mode: 'design' })?.taskType === 'product_ui',
  'inferred route: design mode injects product UI standards');
assert(inferAgentDevelopmentTaskRoute('normal conversation', { mode: 'build' })?.taskType === 'general_code',
  'inferred route: build mode injects code standards');

const promptBlock = buildAgentDevelopmentStandardsPromptBlock('fix a TypeScript planner bug');
assert(promptBlock.includes('TypeScript App Or Runtime Change'), 'prompt block includes route title');
assert(promptBlock.includes('docs/TYPESCRIPT_AGENT_BEST_PRACTICES.md'), 'prompt block includes TypeScript doc');
assert(promptBlock.includes('npm run typecheck:app'), 'prompt block includes verification command');
assert(promptBlock.includes('=== AGENT WORKTREE QUALITY CHECKLIST ==='), 'prompt block includes worktree quality checklist');
assert(promptBlock.includes('git status --porcelain=v1 -uall'), 'prompt block includes stable git status guidance');

const scopedPromptBlock = buildAgentDevelopmentStandardsPromptBlock('fix a TypeScript planner bug', {
  changedPaths: ['?? src/lib/genericAppNavigator.ts'],
  hasUnrelatedChanges: true,
});
assert(scopedPromptBlock.includes('src/lib/genericAppNavigator.ts: Generic unfamiliar-app navigation'),
  'prompt block maps scoped changed path owner');
assert(scopedPromptBlock.includes('dirty_worktree'), 'prompt block carries scoped dirty-worktree risk');

const standardsSummary = summarizeRelevantAgentDevelopmentStandards('fix a TypeScript planner bug');
assert(standardsSummary?.taskType === 'typescript', 'standards summary: TypeScript route');
assert(standardsSummary?.standardDocPaths.includes('docs/CODING_AGENT_BEST_PRACTICES.md'), 'standards summary: includes coding doc');
assert(standardsSummary?.standardDocPaths.includes('docs/TYPESCRIPT_AGENT_BEST_PRACTICES.md'), 'standards summary: includes TypeScript doc');
assert(standardsSummary?.wikiArticleIds.includes('typescript-agent-best-practices'), 'standards summary: includes TypeScript wiki article');
assert(standardsSummary?.verificationCommands.includes('npm run typecheck:app'), 'standards summary: includes typecheck command');

const relevantPromptBlock = buildRelevantAgentDevelopmentStandardsPromptBlock('build a responsive dashboard');
assert(relevantPromptBlock?.includes('Modern Web Page Design Agent Guide'), 'relevant prompt block includes web standard');
const automationPromptBlock = buildRelevantAgentDevelopmentStandardsPromptBlock('fix desktop bridge app automation for Photoshop');
assert(automationPromptBlock?.includes('Agentic Computer/App Automation Guide'),
  'relevant prompt block includes computer app automation standard');
assert(automationPromptBlock?.includes('docs/AGENTIC_COMPUTER_APP_AUTOMATION_GUIDE.md'),
  'relevant prompt block includes computer app automation doc');
const scopedAutomationPromptBlock = buildRelevantAgentDevelopmentStandardsPromptBlock('fix desktop bridge app automation for Photoshop', {
  changedPaths: [' M src/lib/chatComputerRequestRouter.ts'],
});
assert(scopedAutomationPromptBlock?.includes('Chat computer/browser/desktop runtime'),
  'relevant prompt block maps scoped chat computer owner');
const toolContractPromptBlock = buildRelevantAgentDevelopmentStandardsPromptBlock('add an OpenSwan tool schema with approval metadata and recovery evals');
assert(toolContractPromptBlock?.includes('Agent Tool Contracts And Evals Guide'),
  'relevant prompt block includes agent tool contract standard');
assert(toolContractPromptBlock?.includes('docs/AGENT_TOOL_CONTRACTS_AND_EVALS_GUIDE.md'),
  'relevant prompt block includes agent tool contract doc');
assert(toolContractPromptBlock?.includes('=== AGENT TOOL CONTRACT CHECKLIST ==='),
  'relevant prompt block includes concrete tool contract checklist');
assert(toolContractPromptBlock?.includes('Required evals:'),
  'relevant prompt block includes concrete eval checklist');
assert(buildRelevantAgentDevelopmentStandardsPromptBlock('normal conversation about lunch') === null,
  'relevant prompt block skips unrelated chat');

const wrappedHandoff = applyAgentDevelopmentStandardsToPrompt('fix a TypeScript planner bug');
assert(wrappedHandoff.includes('=== AGENT DEVELOPMENT STANDARDS ==='), 'handoff wrapper appends standards block');
assert(wrappedHandoff.includes('docs/TYPESCRIPT_AGENT_BEST_PRACTICES.md'), 'handoff wrapper includes relevant TypeScript doc');
assert(applyAgentDevelopmentStandardsToPrompt(wrappedHandoff) === wrappedHandoff, 'handoff wrapper is idempotent');
assert(applyAgentDevelopmentStandardsToPrompt('normal conversation about lunch') === 'normal conversation about lunch',
  'handoff wrapper skips unrelated chat');
const scopedWrappedHandoff = applyAgentDevelopmentStandardsToPrompt('fix desktop bridge app automation for Photoshop', {
  changedPaths: [' M src/lib/chatComputerRequestUx.ts'],
});
assert(scopedWrappedHandoff.includes('src/lib/chatComputerRequestUx.ts: Chat computer/browser/desktop runtime'),
  'handoff wrapper carries scoped changed path ownership');
const configWrappedHandoff = applyAgentDevelopmentStandardsToPrompt('fix desktop bridge app automation for Photoshop', {
  worktreeConfigSnapshot: {
    status: 'watch',
    score: 92,
    label: 'WORKTREE WATCH',
    summary: 'Synthetic worktree config warning for smoke coverage.',
    isOpenSwanWorktree: false,
    blockers: [],
    warnings: ['.remember/logs/ is visible in git status and should be ignored or cleaned before review.'],
    nextActions: ['Keep runtime artifacts local-only.'],
    items: [
      {
        id: 'synthetic-runtime-artifact',
        label: 'Synthetic runtime artifact',
        status: 'warn',
        detail: 'Synthetic smoke warning.',
      },
    ],
  },
});
assert(configWrappedHandoff.includes('SwanBot/OpenSwan Worktree Config'),
  'handoff wrapper carries OpenSwan worktree config block');
assert(configWrappedHandoff.includes('status: watch'), 'handoff wrapper carries OpenSwan worktree config status');

const worktreeChecklist = buildAgentWorktreeQualityChecklist({
  taskDescription: 'keep optimizing chat desktop app automation',
  changedPaths: [
    '?? src/lib/genericAppNavigator.ts',
    ' M src/lib/chatComputerRequestRouter.ts',
    ' M docs/AGENTS_ROADMAP.md',
  ],
  hasUnrelatedChanges: true,
});
assert(worktreeChecklist.readOrder.includes('docs/AGENTS_ROADMAP.md'), 'worktree checklist includes roadmap read order');
assert(worktreeChecklist.pathFindings.some((finding) => (
  finding.path === 'src/lib/genericAppNavigator.ts' &&
  finding.ownerRuleId === 'generic_app_navigation' &&
  finding.isUntracked
)), 'worktree checklist maps untracked generic app navigator owner');
assert(worktreeChecklist.pathFindings.some((finding) => (
  finding.path === 'src/lib/chatComputerRequestRouter.ts' &&
  finding.ownerRuleId === 'chat_computer_runtime'
)), 'worktree checklist maps chat computer owner');
assert(worktreeChecklist.riskIds.includes('dirty_worktree'), 'worktree checklist flags dirty worktree');
assert(worktreeChecklist.riskIds.includes('untracked_canonical_file'), 'worktree checklist flags untracked canonical file');
assert(worktreeChecklist.riskIds.includes('verification_gap'), 'worktree checklist flags missing focused smoke path');
assert(worktreeChecklist.riskIds.includes('cross_surface_change'), 'worktree checklist flags cross-surface change');
assert(worktreeChecklist.verificationCommands.includes('npm run smoke:generic-app-navigator'),
  'worktree checklist includes generic navigator smoke');
assert(worktreeChecklist.verificationCommands.includes('npm run smoke:chat-computer-request-router'),
  'worktree checklist includes chat computer router smoke');

const openswanConfigChecklist = buildAgentWorktreeQualityChecklist({
  taskDescription: 'tighten SwanBot OpenSwan worktree configuration',
  changedPaths: [
    '?? src/lib/openswanWorktreeConfig.ts',
    '?? scripts/openswan-worktree-config-smoketest.ts',
  ],
});
assert(openswanConfigChecklist.pathFindings.every((finding) => finding.ownerRuleId === 'agent_standards'),
  'worktree checklist maps OpenSwan worktree config to standards owner');
assert(openswanConfigChecklist.verificationCommands.includes('npm run smoke:openswan-worktree-config'),
  'worktree checklist includes OpenSwan worktree config smoke');

const worktreePrompt = formatAgentWorktreeQualityChecklistPromptBlock(worktreeChecklist);
assert(worktreePrompt.includes('Generic unfamiliar-app navigation'), 'worktree prompt names generic app owner');
assert(worktreePrompt.includes('Chat computer/browser/desktop runtime'), 'worktree prompt names chat computer owner');
assert(worktreePrompt.includes('cross_surface_change'), 'worktree prompt includes risk flags');
assert(buildAgentWorktreeQualityPromptBlock().includes('Run git status --porcelain=v1 -uall before editing'),
  'empty worktree prompt asks for git status first');

const currentWorktreeCoverage = buildAgentWorktreeQualityChecklist({
  taskDescription: 'clean up the worktree so every file has a reason',
  changedPaths: [
    ' M package.json',
    ' M src/lib/chatAutomationPlanner.ts',
    ' M src/lib/swanbot.ts',
    '?? src/lib/secondBrainSiteMap.ts',
    '?? src/lib/executionSurfaceRouter.ts',
    '?? src/lib/indesignRecovery.ts',
    ' M src/components/AppHeader.tsx',
    ' M scripts/claude-bridge.js',
    '?? docs/SWANBOT_PIPELINE_RESEARCH_2026-05-15.md',
  ],
  hasUnrelatedChanges: true,
});
const coverageOwners = new Set(currentWorktreeCoverage.pathFindings.map((finding) => finding.ownerRuleId));
assert(coverageOwners.has('package_scripts_and_repo_metadata'), 'worktree coverage maps package metadata');
assert(coverageOwners.has('chat_task_planning_metadata'), 'worktree coverage maps chat planning metadata');
assert(coverageOwners.has('openswan_agent_runtime'), 'worktree coverage maps OpenSwan runtime');
assert(coverageOwners.has('second_brain_research_surfaces'), 'worktree coverage maps second brain research files');
assert(coverageOwners.has('chat_computer_runtime'), 'worktree coverage maps execution surface router');
assert(coverageOwners.has('app_automation_control_surfaces'), 'worktree coverage maps InDesign recovery');
assert(coverageOwners.has('product_ui_surfaces'), 'worktree coverage maps product UI surfaces');
assert(coverageOwners.has('planning_research_docs'), 'worktree coverage maps planning research docs');
assert(![...coverageOwners].some((owner) => owner.startsWith('unmapped_') || owner === 'general_worktree'),
  'worktree coverage sample has no unmapped or generic owners');

console.log('\nAll agent standards wiki smoke cases passed.');
