import {
  buildBrowserAIModalDecisionPrompt,
  buildBrowserAIModalObservation,
  classifyBrowserAIModalRisk,
  decideBrowserAIModalAction,
  parseBrowserAIModalCandidate,
  validateBrowserAIModalCandidate,
} from '../src/lib/browserAIModalAdvisor';

let failures = 0;
function fail(message: string) { failures += 1; console.error('FAIL:', message); }
function pass(message: string) { console.log('pass:', message); }
function assert(condition: unknown, message: string, detail?: string) {
  if (condition) pass(message);
  else fail(`${message}${detail ? ` - ${detail}` : ''}`);
}

const task = 'Upload the design and save the downloaded file as lmao.png, replacing the old lmao.png if needed.';

const replaceObservation = buildBrowserAIModalObservation({
  dialogType: 'confirm',
  message: '"lmao.png" already exists. Do you want to replace it?',
  url: 'https://example.test/export',
  title: 'Export',
});

assert(replaceObservation.buttons.some((button) => button.id === 'accept'), 'observation: confirm has accept button');
assert(replaceObservation.buttons.some((button) => button.id === 'dismiss'), 'observation: confirm has dismiss button');

const prompt = buildBrowserAIModalDecisionPrompt({ task, observation: replaceObservation });
assert(prompt.includes('browser native popup'), 'prompt: names browser popup decision');
assert(prompt.includes('Never accept credentials'), 'prompt: includes credential guardrail');
assert(prompt.includes('lmao.png'), 'prompt: includes popup filename');

const replaceDecision = decideBrowserAIModalAction({ observation: replaceObservation, task });
assert(replaceDecision.action === 'accept_dialog', 'local policy: accepts requested overwrite');
assert(replaceDecision.risk === 'replace_requested_output', 'local policy: overwrite risk tagged');
assert(replaceDecision.buttonId === 'accept', 'local policy: accepts via accept button');

const wrongFileDecision = decideBrowserAIModalAction({
  observation: replaceObservation,
  task: 'Save the downloaded file as proof.png.',
});
assert(wrongFileDecision.action !== 'accept_dialog', 'local policy: wrong overwrite target is blocked');
assert(!!wrongFileDecision.userMessage, 'local policy: wrong overwrite target asks user');

const alertObservation = buildBrowserAIModalObservation({
  dialogType: 'alert',
  message: 'Export complete.',
});
const alertDecision = decideBrowserAIModalAction({ observation: alertObservation, task });
assert(alertDecision.action === 'accept_dialog', 'local policy: safe alert accepted');
assert(classifyBrowserAIModalRisk(alertObservation) === 'safe_acknowledgement', 'risk: safe alert classified');

const credentialObservation = buildBrowserAIModalObservation({
  dialogType: 'prompt',
  message: 'Enter your verification code to continue',
  defaultValue: '',
});
const credentialDecision = decideBrowserAIModalAction({ observation: credentialObservation, task });
assert(credentialDecision.action !== 'accept_dialog', 'local policy: verification prompt blocked');
assert(credentialDecision.risk === 'credential_or_identity', 'risk: verification prompt classified');

const beforeUnloadObservation = buildBrowserAIModalObservation({
  dialogType: 'beforeunload',
  message: 'Changes you made may not be saved.',
});
const beforeUnloadDecision = decideBrowserAIModalAction({ observation: beforeUnloadObservation, task: 'Go to a new page.' });
assert(beforeUnloadDecision.action !== 'accept_dialog', 'local policy: beforeunload unsaved changes blocked');
assert(beforeUnloadDecision.risk === 'destructive', 'risk: beforeunload unsaved changes classified destructive');

const unknownObservation = buildBrowserAIModalObservation({
  dialogType: 'confirm',
  message: 'Do you want to continue?',
});
const unknownDecision = decideBrowserAIModalAction({ observation: unknownObservation, task: 'Open the dashboard.' });
assert(unknownDecision.action === 'ask_user' || unknownDecision.action === 'stop', 'local policy: vague confirm is not accepted automatically');

const parsed = parseBrowserAIModalCandidate('```json\n{"action":"accept_dialog","buttonId":"accept","confidence":0.91,"risk":"replace_requested_output","reason":"requested output file"}\n```');
assert(parsed?.action === 'accept_dialog', 'parser: extracts fenced JSON candidate');

const validCandidate = validateBrowserAIModalCandidate({
  candidate: parsed!,
  observation: replaceObservation,
  task,
});
assert(validCandidate.action === 'accept_dialog', 'validator: accepts guarded LLM overwrite candidate');
assert(validCandidate.source === 'llm_candidate', 'validator: records LLM source');

const lowConfidence = validateBrowserAIModalCandidate({
  candidate: { action: 'accept_dialog', buttonId: 'accept', confidence: 0.62, risk: 'safe_acknowledgement' },
  observation: alertObservation,
  task,
});
assert(lowConfidence.action !== 'accept_dialog', 'validator: low confidence is blocked');

const destructiveCandidate = validateBrowserAIModalCandidate({
  candidate: { action: 'accept_dialog', buttonId: 'accept', confidence: 0.98, risk: 'destructive', reason: 'leave page' },
  observation: beforeUnloadObservation,
  task: 'Go to a new page.',
});
assert(destructiveCandidate.action !== 'accept_dialog', 'validator: destructive accept candidate is blocked');

const invisibleButton = validateBrowserAIModalCandidate({
  candidate: { action: 'accept_dialog', buttonId: 'delete', confidence: 0.99, risk: 'safe_acknowledgement' },
  observation: alertObservation,
  task,
});
assert(invisibleButton.action !== 'accept_dialog', 'validator: invisible button is blocked');

if (failures > 0) {
  console.error(`\n${failures} browser AI modal advisor smoke-test failure(s)`);
  process.exit(1);
}

console.log('\nAll browser AI modal advisor smoke cases passed.');
