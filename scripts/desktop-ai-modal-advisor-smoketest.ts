import assert from 'node:assert/strict';
import {
  buildDesktopAIModalDecisionPrompt,
  decideDesktopAIModalAction,
  extractDesktopAIModalObservation,
  parseDesktopAIModalCandidate,
  validateDesktopAIModalCandidate,
  type DesktopAIModalNode,
} from '../src/lib/desktopAIModalAdvisor';

const replaceExistingTree: DesktopAIModalNode = {
  id: '0',
  role: 'AXWindow',
  label: 'Adobe Photoshop',
  children: [
    { id: '0.1', role: 'AXStaticText', label: '"lmao.png" already exists. Do you want to replace it?' },
    { id: '0.2', role: 'AXButton', label: 'Cancel' },
    { id: '0.3', role: 'AXButton', label: 'Replace' },
  ],
};

const extensionMismatchTree: DesktopAIModalNode = {
  id: '0',
  role: 'AXWindow',
  label: 'Adobe Photoshop',
  children: [
    {
      id: '0.1',
      role: 'AXStaticText',
      label: 'You have used the extension ".png" at the end of the name. The standard extension is ".jpg".',
    },
    { id: '0.2', role: 'AXButton', label: 'Use .jpg' },
    { id: '0.3', role: 'AXButton', label: 'Use .png' },
    { id: '0.4', role: 'AXButton', label: 'Cancel' },
  ],
};

const passwordTree: DesktopAIModalNode = {
  id: '0',
  role: 'AXDialog',
  label: 'Keychain Access',
  children: [
    { id: '0.1', role: 'AXStaticText', label: 'Photoshop wants to use your confidential information stored in Keychain. Enter password to allow this.' },
    { id: '0.2', role: 'AXButton', label: 'Always Allow' },
    { id: '0.3', role: 'AXButton', label: 'Deny' },
  ],
};

const unknownTree: DesktopAIModalNode = {
  id: '0',
  role: 'AXWindow',
  label: 'Example App',
  children: [
    { id: '0.1', role: 'AXStaticText', label: 'Choose how this document should be processed.' },
    { id: '0.2', role: 'AXButton', label: 'Basic' },
    { id: '0.3', role: 'AXButton', label: 'Advanced' },
  ],
};

const task = 'open the file Screenshot 2026-05-21 at 4.44.42 PM on the desktop and open it in Photoshop and rename it lmao and save it as a png';
const observation = extractDesktopAIModalObservation(replaceExistingTree, 'Adobe Photoshop');

assert(observation, 'extracts a modal observation');
assert.equal(observation?.buttons.length, 2, 'extracts visible modal buttons');

const prompt = buildDesktopAIModalDecisionPrompt({ task, observation: observation! });
assert(prompt.includes('Return JSON only'), 'advisor prompt requests structured JSON');
assert(prompt.includes('Buttons: 0.2=Cancel | 0.3=Replace'), 'advisor prompt includes button ids and labels');
assert(prompt.includes('Never auto-click credentials'), 'advisor prompt carries safety policy');
assert(prompt.includes('file-extension mismatch'), 'advisor prompt carries extension mismatch policy');

const replaceDecision = decideDesktopAIModalAction({
  root: replaceExistingTree,
  app: 'Adobe Photoshop',
  task,
});

assert.equal(replaceDecision?.action, 'click_button', 'auto-clicks Replace for the requested output filename');
assert.equal(replaceDecision?.buttonLabel, 'Replace', 'selects the Replace button');
assert.equal(replaceDecision?.risk, 'replace_requested_output', 'classifies replacement as requested output risk');

const wrongFileDecision = decideDesktopAIModalAction({
  root: replaceExistingTree,
  app: 'Adobe Photoshop',
  task: 'save the image as other.png',
});

assert.equal(wrongFileDecision?.action, 'stop', 'does not overwrite a filename not requested by the task');

const keepPngDecision = decideDesktopAIModalAction({
  root: extensionMismatchTree,
  app: 'Adobe Photoshop',
  task,
});

assert.equal(keepPngDecision?.action, 'click_button', 'auto-clicks requested extension mismatch button');
assert.equal(keepPngDecision?.buttonLabel, 'Use .png', 'keeps the user-requested PNG extension');
assert.equal(keepPngDecision?.risk, 'keep_requested_extension', 'classifies extension mismatch separately from generic safe acknowledgements');

const wrongExtensionDecision = decideDesktopAIModalAction({
  root: extensionMismatchTree,
  app: 'Adobe Photoshop',
  task: 'save the image as lmao.jpg',
});

assert.equal(wrongExtensionDecision?.action, 'stop', 'does not keep a PNG extension when the task requested JPG');

const passwordDecision = decideDesktopAIModalAction({
  root: passwordTree,
  app: 'Keychain Access',
  task,
});

assert.equal(passwordDecision?.action, 'stop', 'blocks credential and identity popups');
assert.equal(passwordDecision?.risk, 'credential_or_identity', 'classifies credential popup');

const unknownDecision = decideDesktopAIModalAction({
  root: unknownTree,
  app: 'Example App',
  task,
});

assert.equal(unknownDecision?.action, 'ask_user', 'asks the user for unknown modal choices');

const guardedCandidate = validateDesktopAIModalCandidate({
  observation: observation!,
  task,
  candidate: {
    action: 'click_button',
    buttonId: '0.3',
    confidence: 0.92,
    risk: 'replace_requested_output',
    reason: 'The user asked to save as lmao.png and the dialog is replacing that exact output.',
  },
});

assert.equal(guardedCandidate.action, 'click_button', 'accepts a high-confidence guarded AI candidate');
assert.equal(guardedCandidate.source, 'llm_candidate', 'preserves LLM candidate source after validation');

const extensionCandidate = validateDesktopAIModalCandidate({
  observation: extractDesktopAIModalObservation(extensionMismatchTree, 'Adobe Photoshop')!,
  task,
  candidate: {
    action: 'click_button',
    buttonId: '0.3',
    confidence: 0.91,
    risk: 'keep_requested_extension',
    reason: 'The user asked for PNG output and this button keeps .png.',
  },
});

assert.equal(extensionCandidate.action, 'click_button', 'accepts guarded AI candidate for requested extension mismatch');

const blockedExtensionCandidate = validateDesktopAIModalCandidate({
  observation: extractDesktopAIModalObservation(extensionMismatchTree, 'Adobe Photoshop')!,
  task,
  candidate: {
    action: 'click_button',
    buttonId: '0.2',
    confidence: 0.99,
    risk: 'keep_requested_extension',
    reason: 'Use the standard extension.',
  },
});

assert.equal(blockedExtensionCandidate.action, 'stop', 'blocks AI candidate that would switch away from the requested extension');

const parsedCandidate = parseDesktopAIModalCandidate('```json\n{"action":"click_button","buttonId":"0.3","confidence":0.91,"risk":"replace_requested_output","reason":"requested output"}\n```');
assert.equal(parsedCandidate?.buttonId, '0.3', 'parses fenced JSON modal advisor responses');

const blockedCandidate = validateDesktopAIModalCandidate({
  observation: extractDesktopAIModalObservation(passwordTree, 'Keychain Access')!,
  task,
  candidate: {
    action: 'click_button',
    buttonLabel: 'Always Allow',
    confidence: 0.99,
    risk: 'credential_or_identity',
    reason: 'Continue the task.',
  },
});

assert.equal(blockedCandidate.action, 'stop', 'guardrails block unsafe AI candidate clicks');

// Regression: a normal app MAIN window (Notes) with a toolbar of buttons and
// content roles (outline/splitgroup/scrollarea) must NOT be treated as a
// modal — previously its toolbar was read as "popup options" and halted every
// desktop task at step 1 with "popup needs a decision".
const notesMainWindowTree: DesktopAIModalNode = {
  id: '0',
  role: 'AXApplication',
  label: 'Notes',
  children: [
    {
      id: '0.1',
      role: 'AXWindow',
      label: 'Notes – 15 notes',
      children: [
        { id: '0.1.1', role: 'AXSplitGroup', children: [
          { id: '0.1.1.1', role: 'AXScrollArea', children: [
            { id: '0.1.1.1.1', role: 'AXOutline', label: 'Folders', children: [
              { id: '0.1.1.1.1.1', role: 'AXRow', children: [{ id: '0.1.1.1.1.1.1', role: 'AXStaticText', label: 'Notes, 15 notes' }] },
            ] },
          ] },
        ] },
        { id: '0.1.2', role: 'AXButton', label: 'New Note' },
        { id: '0.1.3', role: 'AXButton', label: 'Format' },
        { id: '0.1.4', role: 'AXButton', label: 'Checklist' },
        { id: '0.1.5', role: 'AXButton', label: 'Table' },
        { id: '0.1.6', role: 'AXButton', label: 'Share' },
      ],
    },
  ],
};

assert.equal(
  extractDesktopAIModalObservation(notesMainWindowTree, 'Notes'),
  null,
  'a normal app main window (Notes, with outline/splitgroup + toolbar) is not a modal',
);
assert.equal(
  decideDesktopAIModalAction({ root: notesMainWindowTree, app: 'Notes', task: 'create a note that says hi' }),
  null,
  'no blocking decision is raised for a normal app window — the task proceeds',
);

// The existing decision trees must still register as modals so real popups are
// still caught (no false-negatives from the fix).
assert.ok(extractDesktopAIModalObservation(replaceExistingTree, 'Adobe Photoshop'), 'overwrite dialog (window, no content) still a modal');
assert.ok(extractDesktopAIModalObservation(passwordTree, 'Keychain Access'), 'credential dialog (AXDialog) still a modal');
assert.ok(extractDesktopAIModalObservation(unknownTree, 'Example App'), 'unknown choice dialog (window, no content) still a modal');

console.log('All desktop AI modal advisor smoke cases passed.');
