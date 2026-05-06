/**
 * browserbase-workflow-intent-smoketest — locks the chat/OpenSwan
 * Browserbase use-case classifier against the three supported docs flows:
 * web data retrieval, Stagehand semantic actions, and form submissions.
 *
 * Run: npm run smoke:browserbase-workflows
 */

import { analyzeBrowserTask } from '../src/lib/browserTaskIntent';
import { classifyBrowserbaseWorkflow } from '../src/lib/browserbaseWorkflowIntent';
import { detectComputerUseIntent } from '../src/lib/computerUseIntent';
import { planComputerTaskPreview } from '../src/lib/computerTaskPlanner';

let failures = 0;

function fail(message: string) {
  failures += 1;
  console.error('FAIL:', message);
}

function pass(message: string) {
  console.log('pass:', message);
}

function assert(condition: unknown, message: string, detail?: string) {
  if (condition) pass(message);
  else fail(`${message}${detail ? ` — ${detail}` : ''}`);
}

function main() {
  const dataTask = 'Extract product names, prices, and stock status from https://example.com/catalog as structured JSON';
  const stagehandTask = 'Use Stagehand to open https://example.com and click the documentation link, then extract the page title';
  const formTask = 'Complete the application form at https://example.com/apply with the provided values and submit it after I approve';

  const dataWorkflow = classifyBrowserbaseWorkflow(dataTask);
  assert(dataWorkflow.kind === 'web_data_retrieval', 'workflow: data retrieval classified');
  assert(dataWorkflow.expectsStructuredOutput, 'workflow: data retrieval expects structured output');

  const stagehandWorkflow = classifyBrowserbaseWorkflow(stagehandTask);
  assert(stagehandWorkflow.kind === 'stagehand_browser_agent', 'workflow: Stagehand classified');
  assert(stagehandWorkflow.requiresStagehand, 'workflow: Stagehand requires Stagehand backend');

  const formWorkflow = classifyBrowserbaseWorkflow(formTask);
  assert(formWorkflow.kind === 'form_submission', 'workflow: form submission classified');
  assert(formWorkflow.requiresSubmissionVerification, 'workflow: form submission requires verification');

  assert(detectComputerUseIntent(dataTask).route, 'chat intent: data retrieval routes to Computer Use');
  assert(detectComputerUseIntent(stagehandTask).route, 'chat intent: Stagehand routes to Computer Use');
  assert(detectComputerUseIntent(formTask).route, 'chat intent: form submission routes to Computer Use');

  const dataIntent = analyzeBrowserTask(dataTask);
  assert(dataIntent.mode === 'extract', 'browser intent: data retrieval mode is extract');
  assert(dataIntent.browserbaseWorkflow.kind === 'web_data_retrieval', 'browser intent: carries Browserbase workflow');

  const formIntent = analyzeBrowserTask(formTask);
  assert(formIntent.mode === 'transactional', 'browser intent: form submission is transactional');
  assert(formIntent.hasSideEffects, 'browser intent: form submission has side effects');

  const preview = planComputerTaskPreview(stagehandTask);
  assert(preview.kind === 'browser_task', 'computer planner: Stagehand is browser task');
  assert(preview.requiredCapabilities.includes('browser_sessions'), 'computer planner: Browserbase workflow wants browser sessions');

  if (failures > 0) {
    console.error(`\n${failures} Browserbase workflow smoke-test failure(s)`);
    process.exit(1);
  }
  console.log('\nAll Browserbase workflow smoke cases passed.');
}

main();
