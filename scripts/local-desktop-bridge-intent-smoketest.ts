/**
 * local-desktop-bridge-intent-smoketest - pins chat routing for local
 * desktop bridge awareness/actions. Read-only requests should stay on
 * the lightweight OpenSwan bridge path; file/app execution should use
 * the shared computer-task runtime instead of falling back to plain chat.
 *
 * Run: npm run smoke:local-desktop-bridge-intent
 */

import {
  buildInDesignBannerClarification,
  buildPhotoshopGenerativeFillClarification,
  detectLocalComputerAwarenessIntent,
  detectLocalComputerAwarenessIntentSequence,
  type LocalComputerAwarenessKind,
} from '../src/lib/localComputerAwarenessIntent';
import { buildChatAutomationPlan } from '../src/lib/chatAutomationPlanner';
import { buildInDesignRecoveryCandidatesForIntent } from '../src/lib/indesignRecovery';
import { planComputerTaskPreview } from '../src/lib/computerTaskPlanner';
import { buildComputerTaskGrantPlan } from '../src/lib/computerTaskGrants';
import { detectBlockingAppModalPlan } from '../src/lib/desktopBlockingModals';

let failures = 0;
const PHOTOSHOP_SCREENSHOT_RENAME_REQUEST = 'open the file Screenshot 2026-05-21 at 4.44.42\u202fPM thats on the desktop and open it in Photoshop and rename it lmao and save it as a png';

function fail(message: string) {
  failures += 1;
  console.error('FAIL:', message);
}

function pass(message: string) {
  console.log('pass:', message);
}

function assert(condition: unknown, message: string, detail?: string) {
  if (condition) pass(message);
  else fail(`${message}${detail ? ` - ${detail}` : ''}`);
}

function assertIntent(
  message: string,
  expectedKind: LocalComputerAwarenessKind,
  expected?: Partial<{ appQuery: string; url: string; path: string; text: string; x: number; y: number; mouseButton: 'left' | 'right'; clickCount: number }>,
  expectedExecution: 'run_openswan' | 'run_computer_task' = 'run_openswan',
) {
  const intent = detectLocalComputerAwarenessIntent(message);
  assert(intent.route, `"${message}" routes to local desktop bridge`, intent.reason);
  assert(intent.kind === expectedKind, `"${message}" kind = ${expectedKind}`, `saw ${intent.kind}`);
  if (expected?.appQuery !== undefined) {
    assert(intent.appQuery === expected.appQuery, `"${message}" appQuery parsed`, `saw ${intent.appQuery}`);
  }
  if (expected?.url !== undefined) {
    assert(intent.url === expected.url, `"${message}" url parsed`, `saw ${intent.url}`);
  }
  if (expected?.path !== undefined) {
    assert(intent.path === expected.path, `"${message}" path parsed`, `saw ${intent.path}`);
  }
  if (expected?.text !== undefined) {
    assert(intent.text === expected.text, `"${message}" clipboard text parsed`, `saw ${intent.text}`);
  }
  if (expected?.x !== undefined) {
    assert(intent.x === expected.x, `"${message}" x parsed`, `saw ${intent.x}`);
  }
  if (expected?.y !== undefined) {
    assert(intent.y === expected.y, `"${message}" y parsed`, `saw ${intent.y}`);
  }
  if (expected?.mouseButton !== undefined) {
    assert(intent.mouseButton === expected.mouseButton, `"${message}" mouse button parsed`, `saw ${intent.mouseButton}`);
  }
  if (expected?.clickCount !== undefined) {
    assert(intent.clickCount === expected.clickCount, `"${message}" click count parsed`, `saw ${intent.clickCount}`);
  }

  const plan = buildChatAutomationPlan({ message });
  assert(
    plan.execution.kind === expectedExecution,
    `"${message}" uses ${expectedExecution}`,
    `saw ${plan.execution.kind}`,
  );
  if (expectedExecution !== 'run_computer_task') {
    assert(
      plan.execution.kind !== 'run_computer_task',
      `"${message}" does not start Computer Use`,
    );
  }
}

function assertExtraIntent(
  message: string,
  expectedKind: LocalComputerAwarenessKind,
  verify: (intent: ReturnType<typeof detectLocalComputerAwarenessIntent>) => void,
  expectedExecution: 'run_openswan' | 'run_computer_task' = 'run_openswan',
) {
  const intent = detectLocalComputerAwarenessIntent(message);
  assert(intent.route, `"${message}" routes to local desktop bridge`, intent.reason);
  assert(intent.kind === expectedKind, `"${message}" kind = ${expectedKind}`, `saw ${intent.kind}`);
  verify(intent);
  const plan = buildChatAutomationPlan({ message });
  assert(plan.execution.kind === expectedExecution, `"${message}" uses ${expectedExecution}`, `saw ${plan.execution.kind}`);
}

function assertSequence(
  message: string,
  verify: (sequence: ReturnType<typeof detectLocalComputerAwarenessIntentSequence>) => void,
) {
  const sequence = detectLocalComputerAwarenessIntentSequence(message);
  assert(sequence.length > 1, `"${message}" parses as a desktop sequence`, `saw ${sequence.length} steps`);
  verify(sequence);
  const plan = buildChatAutomationPlan({ message });
  assert(plan.execution.kind === 'run_computer_task', `"${message}" uses run_computer_task`, `saw ${plan.execution.kind}`);
}

function assertBlockingModalDetection() {
  const missingFontsTree = {
    id: '0',
    role: 'AXApplication',
    label: 'Adobe InDesign 2026',
    children: [
      {
        id: '0.0',
        role: 'AXSheet',
        label: 'Missing Fonts',
        children: [
          { id: '0.0.0', role: 'AXStaticText', label: 'Some fonts in this document are missing.' },
          { id: '0.0.1', role: 'AXButton', label: 'Replace Fonts' },
          { id: '0.0.2', role: 'AXButton', label: 'Skip' },
        ],
      },
    ],
  };
  const missingFontsPlan = detectBlockingAppModalPlan(missingFontsTree, 'InDesign');
  assert(missingFontsPlan?.policyId === 'indesign_missing_fonts', 'blocking modal detector recognizes InDesign missing fonts', missingFontsPlan?.policyId);
  assert(missingFontsPlan?.buttonLabel === 'Skip', 'blocking modal detector picks safe Missing Fonts continuation', missingFontsPlan?.buttonLabel);

  const modifiedLinksTree = {
    id: '0',
    role: 'AXApplication',
    label: 'Adobe InDesign 2026',
    children: [
      {
        id: '0.0',
        role: 'AXDialog',
        label: 'Modified Links',
        children: [
          { id: '0.0.0', role: 'AXStaticText', label: 'Links have been modified. Update links now?' },
          { id: '0.0.1', role: 'AXButton', label: 'Update Links' },
          { id: '0.0.2', role: 'AXButton', label: "Don't Update Links" },
        ],
      },
    ],
  };
  const linksPlan = detectBlockingAppModalPlan(modifiedLinksTree, 'InDesign');
  assert(linksPlan?.policyId === 'indesign_missing_or_modified_links', 'blocking modal detector recognizes InDesign link dialogs', linksPlan?.policyId);
  assert(linksPlan?.buttonLabel === "Don't Update Links", 'blocking modal detector avoids mutating linked assets', linksPlan?.buttonLabel);

  const normalAppTree = {
    id: '0',
    role: 'AXApplication',
    label: 'Adobe InDesign 2026',
    children: [
      { id: '0.0', role: 'AXWindow', label: 'Document', children: [{ id: '0.0.0', role: 'AXButton', label: 'OK' }] },
    ],
  };
  assert(detectBlockingAppModalPlan(normalAppTree, 'InDesign') === null, 'blocking modal detector ignores normal app controls');
}

function main() {
  assertBlockingModalDetection();

  assertIntent(
    'are you able to see all of the Chrome tabs I have open?',
    'browser_tabs',
  );
  assertIntent(
    'need you to tell me all my tabs open in chrome right now',
    'browser_tabs',
  );
  assertIntent(
    'what apps are open on my computer?',
    'running_apps',
  );
  assertIntent(
    'what is the active window on my screen?',
    'window_state',
  );
  assertIntent(
    'what is on my clipboard?',
    'clipboard',
  );
  assertIntent(
    'copy launch checklist to my clipboard',
    'clipboard_write',
    { text: 'launch checklist' },
  );
  assertIntent(
    'set my clipboard to deploy notes',
    'clipboard_write',
    { text: 'deploy notes' },
  );
  assertIntent(
    'clear my clipboard',
    'clipboard_clear',
  );
  assertExtraIntent(
    'open Chrome',
    'launch_app',
    (intent) => assert(intent.appQuery === 'Chrome', 'launch app parsed', `saw ${intent.appQuery}`),
    'run_computer_task',
  );
  assertExtraIntent(
    'open Photoshop',
    'launch_app',
    (intent) => assert(intent.appQuery === 'Photoshop', 'Photoshop app parsed', `saw ${intent.appQuery}`),
    'run_computer_task',
  );
  assertExtraIntent(
    'Use my computer to open Photoshop',
    'launch_app',
    (intent) => assert(intent.appQuery === 'Photoshop', 'computer-prefixed Photoshop app parsed', `saw ${intent.appQuery}`),
    'run_computer_task',
  );
  // Notes: "create a note that says X" is a Notes-app action (notes_create),
  // NOT a local text-file write. Regression guard for the mis-route that sent
  // "create a note…" into local-file-write-text and spiraled into the generic
  // unknown-app navigator + connected-agent buildout.
  assertExtraIntent(
    'create a note that says hell ya fuckin right bitch',
    'notes_create',
    (intent) => {
      assert(intent.text === 'hell ya fuckin right bitch', 'note body captured', `saw ${JSON.stringify(intent.text)}`);
      assert(intent.appQuery === 'Notes', 'notes_create targets Notes', `saw ${intent.appQuery}`);
      assert(intent.reason === 'local-notes-create', 'notes_create reason is set', `saw ${intent.reason}`);
    },
    'run_computer_task',
  );
  assertExtraIntent(
    "make a note saying don't forget the milk",
    'notes_create',
    (intent) => assert(intent.text === "don't forget the milk", 'saying-form body captured', `saw ${JSON.stringify(intent.text)}`),
    'run_computer_task',
  );
  assertExtraIntent(
    'create a note thats says hell ya fuckin right bitch',
    'notes_create',
    (intent) => assert(intent.text === 'hell ya fuckin right bitch', 'tolerates the "thats says" typo', `saw ${JSON.stringify(intent.text)}`),
    'run_computer_task',
  );
  // The exact phrasing the user reported, as a multi-step sequence: open Notes
  // THEN create the note. Step 2 must be notes_create, never file_write_text.
  assertSequence(
    'open the notes app and create a note thats says hell ya fuckin right bitch',
    (sequence) => {
      const noteStep = sequence.find((step) => step.kind === 'notes_create');
      assert(!!noteStep, 'sequence contains a notes_create step', `saw ${sequence.map((s) => s.kind).join(', ')}`);
      assert(noteStep?.text === 'hell ya fuckin right bitch', 'sequence note body captured', `saw ${JSON.stringify(noteStep?.text)}`);
      assert(!sequence.some((step) => step.kind === 'file_write_text'), 'no step mis-parses as file_write_text');
    },
  );
  // A genuine text-FILE write still routes to file_write_text (not hijacked).
  assertExtraIntent(
    'write a text file to my desktop called todo.txt',
    'file_write_text',
    () => {},
    'run_computer_task',
  );

  assertExtraIntent(
    'inspect Photoshop document status',
    'photoshop_document_status',
    (intent) => assert(intent.appQuery === 'Photoshop', 'Photoshop status targets app', `saw ${intent.appQuery}`),
  );
  assertExtraIntent(
    'show Photoshop layers matching headline',
    'photoshop_layer_inventory',
    (intent) => {
      assert(intent.appQuery === 'Photoshop', 'Photoshop layer inventory targets app', `saw ${intent.appQuery}`);
      assert(intent.query === 'headline', 'Photoshop layer inventory query parsed', `saw ${intent.query}`);
    },
  );
  assertExtraIntent(
    'update Photoshop headline text to Spring Sale',
    'photoshop_update_text_layer',
    (intent) => {
      assert(intent.targetLabel === 'headline', 'Photoshop text layer parsed', `saw ${intent.targetLabel}`);
      assert(intent.text === 'Spring Sale', 'Photoshop replacement text parsed', `saw ${intent.text}`);
    },
  );
  assertExtraIntent(
    'place ~/Desktop/logo.png in Photoshop',
    'photoshop_place_asset',
    (intent) => assert(intent.assetPath === '~/Desktop/logo.png', 'Photoshop asset path parsed', `saw ${intent.assetPath}`),
    'run_computer_task',
  );
  assertExtraIntent(
    'export Photoshop proof as ~/Desktop/proof.png',
    'photoshop_export_proof',
    (intent) => {
      assert(intent.outputPath === '~/Desktop/proof.png', 'Photoshop proof path parsed', `saw ${intent.outputPath}`);
      assert(intent.format === 'png', 'Photoshop proof format parsed', `saw ${intent.format}`);
    },
    'run_computer_task',
  );
  assertExtraIntent(
    'open Photoshop and crop this image',
    'launch_app',
    (intent) => assert(intent.appQuery === 'Photoshop', 'Photoshop follow-up app parsed', `saw ${intent.appQuery}`),
    'run_computer_task',
  );
  assertExtraIntent(
    'open Affinity Designer',
    'launch_app',
    (intent) => assert(intent.appQuery === 'Affinity Designer', 'generic app parsed', `saw ${intent.appQuery}`),
    'run_computer_task',
  );
  assertExtraIntent(
    'open AutoCAD and create a floor plan',
    'launch_app',
    (intent) => assert(intent.appQuery === 'AutoCAD', 'AutoCAD app parsed without swallowing follow-up task', `saw ${intent.appQuery}`),
    'run_computer_task',
  );
  assertExtraIntent(
    'switch to Slack',
    'focus_app',
    (intent) => assert(intent.appQuery === 'Slack', 'focus app parsed', `saw ${intent.appQuery}`),
    'run_computer_task',
  );
  assertExtraIntent(
    'bring Safari to front',
    'focus_app',
    (intent) => assert(intent.appQuery === 'Safari', 'bring-to-front app parsed', `saw ${intent.appQuery}`),
    'run_computer_task',
  );
  assertIntent(
    'open https://example.com/dashboard',
    'open_url',
    { url: 'https://example.com/dashboard' },
  );
  assertIntent(
    'open example.com/docs',
    'open_url',
    { url: 'https://example.com/docs' },
  );
  assertIntent(
    'open ~/Downloads',
    'open_path',
    { path: '~/Downloads' },
    'run_computer_task',
  );
  assertExtraIntent(
    'list files in Downloads',
    'file_list',
    (intent) => assert(intent.path === 'Downloads', 'file list path parsed', `saw ${intent.path}`),
    'run_computer_task',
  );
  assertExtraIntent(
    'read ~/Downloads/report.txt',
    'file_read',
    (intent) => assert(intent.path === '~/Downloads/report.txt', 'file read path parsed', `saw ${intent.path}`),
    'run_computer_task',
  );
  assertExtraIntent(
    'search files in Downloads for invoice',
    'file_search',
    (intent) => {
      assert(intent.rootPath === '~/Downloads', 'file search root parsed', `saw ${intent.rootPath}`);
      assert(intent.query === 'invoice', 'file search query parsed', `saw ${intent.query}`);
    },
    'run_computer_task',
  );
  assertExtraIntent(
    'find honda-banner.indd in Google Drive',
    'file_search',
    (intent) => {
      assert(intent.rootPath === 'google_drive', 'google drive file search root parsed', `saw ${intent.rootPath}`);
      assert(intent.query === 'honda-banner.indd', 'google drive file search query parsed', `saw ${intent.query}`);
      assert(intent.extensions?.includes('indd'), 'google drive file search extension parsed');
    },
    'run_computer_task',
  );
  assertExtraIntent(
    'find and open honda-banner.indd in Google Drive',
    'open_file_search_match',
    (intent) => {
      assert(intent.rootPath === 'google_drive', 'google drive open file root parsed', `saw ${intent.rootPath}`);
      assert(intent.query === 'honda-banner.indd', 'google drive open file query parsed', `saw ${intent.query}`);
      assert(intent.extensions?.includes('indd'), 'google drive open file extension parsed');
    },
    'run_computer_task',
  );
  // P22 regression: "open <AppName> on my computer" is a LAUNCH, not a file
  // search for a file named after the app. Generic-machine root
  // (computer/mac/laptop) + no file extension ⇒ launch_app. Real file opens
  // (extension present, or a Finder-folder root like desktop/downloads) stay
  // file searches — asserted right below.
  assertIntent('Open Photoshop on my computer', 'launch_app', { appQuery: 'Photoshop' }, 'run_computer_task');
  assertIntent('open Illustrator on my mac', 'launch_app', { appQuery: 'Illustrator' }, 'run_computer_task');
  // P22b: new-document phrasing covers spreadsheet/presentation/etc, not just
  // "document/file" — otherwise "start a new spreadsheet" launched an app
  // literally named "a new spreadsheet".
  assertIntent('start a new spreadsheet', 'press_keys', { }, 'run_computer_task');
  assertIntent('make a new presentation', 'press_keys', { }, 'run_computer_task');
  {
    const seq2 = detectLocalComputerAwarenessIntentSequence('open Excel on my mac and create a new spreadsheet');
    assert(seq2[0]?.kind === 'launch_app' && seq2[0]?.appQuery === 'Excel', 'Excel launch step has a clean appQuery (no "on my mac" trailing)', `saw ${seq2[0]?.appQuery}`);
    assert(seq2.some((s) => s.kind === 'press_keys' && s.combo === 'Cmd+N'), 'new spreadsheet step maps to Cmd+N', seq2.map((s) => `${s.kind}:${(s as any).combo || ''}`).join(','));
    assert(!seq2.some((s) => s.kind === 'launch_app' && /on my mac/i.test(s.appQuery || '')), 'no launch step carries a location suffix', seq2.map((s) => s.appQuery || '').join(','));
  }
  {
    // P22b: "save it as <file>" as a trailing sequence step — the bare "it"
    // (no following noun) used to break the regex and abort the whole
    // multi-step task.
    const seq3 = detectLocalComputerAwarenessIntentSequence('open photoshop on my computer and create a new project then save it as hero.png');
    assert(seq3.length >= 3, 'launch+create+save is a full 3-part sequence (no abort)', `saw ${seq3.length}`);
    assert(seq3[0]?.kind === 'launch_app' && /^photoshop$/i.test(seq3[0]?.appQuery || ''), 'step 1 launches Photoshop', `saw ${seq3[0]?.kind}/${seq3[0]?.appQuery}`);
    assert(seq3.some((s) => s.kind === 'press_keys' && s.combo === 'Cmd+N'), 'step 2 creates a new document', seq3.map((s) => (s as any).combo || s.kind).join(','));
    assert(seq3.some((s) => (s.kind === 'paste_text' && /hero\.png/i.test((s as any).text || '')) || s.kind === 'semantic_click'), 'step 3 carries the save-as filename', seq3.map((s) => s.kind).join(','));
  }
  {
    const seq = detectLocalComputerAwarenessIntentSequence('Open Photoshop on my computer and create a new project');
    assert(seq.length >= 2, 'launch+create sequence has both steps', `saw ${seq.length}`);
    assert(seq[0]?.kind === 'launch_app' && seq[0]?.appQuery === 'Photoshop', 'first step launches Photoshop (not a file search)', `saw ${seq[0]?.kind}/${seq[0]?.appQuery}`);
    assert(!seq.some((s) => s.kind === 'open_file_search_match' || s.kind === 'file_search'), 'no file-search step for a fileless launch+create', seq.map((s) => s.kind).join(','));
    assert(seq.some((s) => s.kind === 'press_keys' && s.combo === 'Cmd+N'), 'create-a-new-project maps to Cmd+N', seq.map((s) => `${s.kind}:${(s as any).combo || ''}`).join(','));
  }
  assertExtraIntent(
    'Can you find the landscaping-img.png image on my desktop',
    'file_search',
    (intent) => {
      assert(intent.rootPath === '~/Desktop', 'desktop image search root parsed', `saw ${intent.rootPath}`);
      assert(intent.query === 'landscaping-img.png', 'desktop image search query parsed', `saw ${intent.query}`);
    },
    'run_computer_task',
  );
  assertExtraIntent(
    'open Gemini_Generated_Image_lppqo8lppqo8lppq.png from the desktop and make it a jpg',
    'open_file_search_match',
    (intent) => {
      assert(intent.rootPath === '~/Desktop', 'desktop open-from-root search root parsed', `saw ${intent.rootPath}`);
      assert(intent.query === 'Gemini_Generated_Image_lppqo8lppqo8lppq.png', 'desktop open-from-root filename parsed', `saw ${intent.query}`);
      assert(intent.extensions?.includes('png'), 'desktop open-from-root extension parsed');
      assert(intent.appQuery !== 'Gemini_Generated_Image_lppqo8lppqo8lppq.png from the desktop', 'desktop filename is not misclassified as an app');
    },
    'run_computer_task',
  );
  assertExtraIntent(
    'does the file landscaping-img.png on my desktop exist and what size is it',
    'file_stat',
    () => undefined,
    'run_computer_task',
  );
  assertExtraIntent(
    'change the file landscaping-img.png thats on the desktop to andscaping-img-1.png',
    'file_rename',
    () => undefined,
    'run_computer_task',
  );
  assertExtraIntent(
    'copy landscaping-img.png on my desktop to landscaping-img-copy.png',
    'file_copy',
    () => undefined,
    'run_computer_task',
  );
  assertExtraIntent(
    'move old-screenshot.png on my desktop to trash',
    'file_trash',
    () => undefined,
    'run_computer_task',
  );
  assertExtraIntent(
    'create a folder on my desktop called Project Assets',
    'file_mkdir',
    () => undefined,
    'run_computer_task',
  );
  assertExtraIntent(
    'write a text file on my desktop called notes.txt with hello',
    'file_write_text',
    () => undefined,
    'run_computer_task',
  );
  assertExtraIntent(
    'list my Apple Shortcuts',
    'shortcuts_list',
    () => undefined,
  );
  assertExtraIntent(
    'run shortcut Resize Images',
    'shortcut_run',
    (intent) => assert(intent.shortcutName === 'Resize Images', 'shortcut name parsed', `saw ${intent.shortcutName}`),
  );
  assertExtraIntent(
    'confirm run shortcut Resize Images',
    'shortcut_run',
    (intent) => assert(intent.shortcutName === 'Resize Images', 'confirmed shortcut name parsed', `saw ${intent.shortcutName}`),
  );
  assertExtraIntent(
    'show clickable elements in Safari',
    'a11y_tree',
    (intent) => assert(intent.appQuery === 'Safari', 'a11y app parsed', `saw ${intent.appQuery}`),
  );
  assertExtraIntent(
    'minimize active window',
    'window_manage',
    (intent) => assert(intent.windowAction === 'minimize', 'window action parsed', `saw ${intent.windowAction}`),
    'run_computer_task',
  );
  assertExtraIntent(
    'resize Chrome window to 1200x800',
    'window_manage',
    (intent) => {
      assert(intent.windowAction === 'resize', 'resize action parsed', `saw ${intent.windowAction}`);
      assert(intent.appQuery === 'Chrome', 'resize app parsed', `saw ${intent.appQuery}`);
      assert(intent.width === 1200 && intent.height === 800, 'resize dimensions parsed', `saw ${intent.width}x${intent.height}`);
    },
    'run_computer_task',
  );
  assertExtraIntent(
    'move mouse to 200,300',
    'mouse_move',
    (intent) => {
      assert(intent.x === 200, 'mouse move x parsed', `saw ${intent.x}`);
      assert(intent.y === 300, 'mouse move y parsed', `saw ${intent.y}`);
    },
    'run_computer_task',
  );
  assertExtraIntent(
    'right double click at 400,500',
    'mouse_click',
    (intent) => {
      assert(intent.x === 400, 'mouse click x parsed', `saw ${intent.x}`);
      assert(intent.y === 500, 'mouse click y parsed', `saw ${intent.y}`);
      assert(intent.mouseButton === 'right', 'mouse click button parsed', `saw ${intent.mouseButton}`);
      assert(intent.clickCount === 2, 'mouse click count parsed', `saw ${intent.clickCount}`);
    },
    'run_computer_task',
  );
  assertExtraIntent(
    'scroll down by 700',
    'mouse_scroll',
    (intent) => {
      assert(intent.deltaY === 700, 'mouse scroll delta parsed', `saw ${intent.deltaY}`);
      assert(intent.deltaX === 0, 'mouse scroll x delta parsed', `saw ${intent.deltaX}`);
    },
    'run_computer_task',
  );
  assertExtraIntent(
    'click the Save button in Photoshop',
    'semantic_click',
    (intent) => {
      assert(intent.targetLabel === 'Save', 'semantic click target parsed', `saw ${intent.targetLabel}`);
      assert(intent.appQuery === 'Photoshop', 'semantic click app parsed', `saw ${intent.appQuery}`);
    },
    'run_computer_task',
  );
  assertExtraIntent(
    'click File > Save As in Photoshop',
    'menu_click',
    (intent) => {
      assert(JSON.stringify(intent.menuPath) === JSON.stringify(['File', 'Save As']), 'menu path parsed', `saw ${JSON.stringify(intent.menuPath)}`);
      assert(intent.appQuery === 'Photoshop', 'menu app parsed', `saw ${intent.appQuery}`);
    },
    'run_computer_task',
  );
  assertExtraIntent(
    'type "hello world" in TextEdit',
    'type_text',
    (intent) => {
      assert(intent.text === 'hello world', 'type text parsed', `saw ${intent.text}`);
      assert(intent.appQuery === 'TextEdit', 'type app parsed', `saw ${intent.appQuery}`);
    },
    'run_computer_task',
  );
  assertExtraIntent(
    'paste "hello world" in TextEdit',
    'paste_text',
    (intent) => {
      assert(intent.text === 'hello world', 'paste text parsed', `saw ${intent.text}`);
      assert(intent.appQuery === 'TextEdit', 'paste app parsed', `saw ${intent.appQuery}`);
    },
    'run_computer_task',
  );
  assertExtraIntent(
    'fill the email field with test@example.com in TextEdit',
    'set_field_text',
    (intent) => {
      assert(intent.targetLabel === 'email', 'set field target parsed', `saw ${intent.targetLabel}`);
      assert(intent.text === 'test@example.com', 'set field text parsed', `saw ${intent.text}`);
      assert(intent.appQuery === 'TextEdit', 'set field app parsed', `saw ${intent.appQuery}`);
    },
    'run_computer_task',
  );
  assertExtraIntent(
    'press Command S in Photoshop',
    'press_keys',
    (intent) => {
      assert(intent.combo === 'Cmd+S', 'key combo parsed', `saw ${intent.combo}`);
      assert(intent.appQuery === 'Photoshop', 'key app parsed', `saw ${intent.appQuery}`);
    },
    'run_computer_task',
  );
  assertExtraIntent(
    'save in Photoshop',
    'press_keys',
    (intent) => {
      assert(intent.combo === 'Cmd+S', 'save shortcut parsed', `saw ${intent.combo}`);
      assert(intent.appQuery === 'Photoshop', 'save shortcut app parsed', `saw ${intent.appQuery}`);
    },
    'run_computer_task',
  );
  assertExtraIntent(
    'paste clipboard in TextEdit',
    'press_keys',
    (intent) => {
      assert(intent.combo === 'Cmd+V', 'paste clipboard shortcut parsed', `saw ${intent.combo}`);
      assert(intent.appQuery === 'TextEdit', 'paste clipboard app parsed', `saw ${intent.appQuery}`);
    },
    'run_computer_task',
  );
  assertExtraIntent(
    'quit Photoshop',
    'press_keys',
    (intent) => {
      assert(intent.combo === 'Cmd+Q', 'quit shortcut parsed', `saw ${intent.combo}`);
      assert(intent.appQuery === 'Photoshop', 'quit shortcut app parsed', `saw ${intent.appQuery}`);
    },
    'run_computer_task',
  );
  assertExtraIntent(
    'wait for Photoshop to open',
    'wait_for_app',
    (intent) => {
      assert(intent.appQuery === 'Photoshop', 'wait-for-app target parsed', `saw ${intent.appQuery}`);
      assert(intent.durationMs === 8000, 'wait-for-app default duration parsed', `saw ${intent.durationMs}`);
    },
    'run_computer_task',
  );
  assertExtraIntent(
    'focus the address bar in Chrome',
    'press_keys',
    (intent) => {
      assert(intent.combo === 'Cmd+L', 'address bar shortcut parsed', `saw ${intent.combo}`);
      assert(intent.appQuery === 'Chrome', 'address bar app parsed', `saw ${intent.appQuery}`);
    },
    'run_computer_task',
  );
  assertExtraIntent(
    'go to next tab in Chrome',
    'press_keys',
    (intent) => {
      assert(intent.combo === 'Ctrl+Tab', 'next tab shortcut parsed', `saw ${intent.combo}`);
      assert(intent.appQuery === 'Chrome', 'next tab app parsed', `saw ${intent.appQuery}`);
    },
    'run_computer_task',
  );
  assertExtraIntent(
    'go to previous window in Photoshop',
    'press_keys',
    (intent) => {
      assert(intent.combo === 'Cmd+Shift+`', 'previous window shortcut parsed', `saw ${intent.combo}`);
      assert(intent.appQuery === 'Photoshop', 'previous window app parsed', `saw ${intent.appQuery}`);
    },
    'run_computer_task',
  );
  assertExtraIntent(
    'confirm dialog in Photoshop',
    'press_keys',
    (intent) => {
      assert(intent.combo === 'Return', 'confirm dialog shortcut parsed', `saw ${intent.combo}`);
      assert(intent.appQuery === 'Photoshop', 'confirm dialog app parsed', `saw ${intent.appQuery}`);
    },
    'run_computer_task',
  );
  assertExtraIntent(
    'cancel dialog in Photoshop',
    'press_keys',
    (intent) => {
      assert(intent.combo === 'Escape', 'cancel dialog shortcut parsed', `saw ${intent.combo}`);
      assert(intent.appQuery === 'Photoshop', 'cancel dialog app parsed', `saw ${intent.appQuery}`);
    },
    'run_computer_task',
  );
  assertExtraIntent(
    'zoom in in Chrome',
    'press_keys',
    (intent) => {
      assert(intent.combo === 'Cmd+=', 'zoom in shortcut parsed', `saw ${intent.combo}`);
      assert(intent.appQuery === 'Chrome', 'zoom in app parsed', `saw ${intent.appQuery}`);
    },
    'run_computer_task',
  );
  assertExtraIntent(
    'show settings in Photoshop',
    'press_keys',
    (intent) => {
      assert(intent.combo === 'Cmd+,', 'settings shortcut parsed', `saw ${intent.combo}`);
      assert(intent.appQuery === 'Photoshop', 'settings app parsed', `saw ${intent.appQuery}`);
    },
    'run_computer_task',
  );
  assertExtraIntent(
    'page down in Safari',
    'press_keys',
    (intent) => {
      assert(intent.combo === 'PageDown', 'page down shortcut parsed', `saw ${intent.combo}`);
      assert(intent.appQuery === 'Safari', 'page down app parsed', `saw ${intent.appQuery}`);
    },
    'run_computer_task',
  );
  assertExtraIntent(
    'open private window in Chrome',
    'press_keys',
    (intent) => {
      assert(intent.combo === 'Cmd+Shift+N', 'private window shortcut parsed', `saw ${intent.combo}`);
      assert(intent.appQuery === 'Chrome', 'private window app parsed', `saw ${intent.appQuery}`);
    },
    'run_computer_task',
  );
  assertExtraIntent(
    'open dev tools in Chrome',
    'press_keys',
    (intent) => {
      assert(intent.combo === 'Cmd+Opt+I', 'devtools shortcut parsed', `saw ${intent.combo}`);
      assert(intent.appQuery === 'Chrome', 'devtools app parsed', `saw ${intent.appQuery}`);
    },
    'run_computer_task',
  );
  assertExtraIntent(
    'view source in Chrome',
    'press_keys',
    (intent) => {
      assert(intent.combo === 'Cmd+Opt+U', 'view source shortcut parsed', `saw ${intent.combo}`);
      assert(intent.appQuery === 'Chrome', 'view source app parsed', `saw ${intent.appQuery}`);
    },
    'run_computer_task',
  );
  assertExtraIntent(
    'press enter in TextEdit',
    'press_keys',
    (intent) => {
      assert(intent.combo === 'Return', 'enter key normalizes to Return', `saw ${intent.combo}`);
      assert(intent.appQuery === 'TextEdit', 'enter key app parsed', `saw ${intent.appQuery}`);
    },
    'run_computer_task',
  );
  assertExtraIntent(
    'switch to third tab in Chrome',
    'press_keys',
    (intent) => {
      assert(intent.combo === 'Cmd+3', 'numbered tab shortcut parsed', `saw ${intent.combo}`);
      assert(intent.appQuery === 'Chrome', 'numbered tab app parsed', `saw ${intent.appQuery}`);
    },
    'run_computer_task',
  );
  assertExtraIntent(
    'go back in Chrome',
    'press_keys',
    (intent) => {
      assert(intent.combo === 'Cmd+[', 'browser back shortcut parsed', `saw ${intent.combo}`);
      assert(intent.appQuery === 'Chrome', 'browser back app parsed', `saw ${intent.appQuery}`);
    },
    'run_computer_task',
  );
  assertExtraIntent(
    'hard refresh in Chrome',
    'press_keys',
    (intent) => {
      assert(intent.combo === 'Cmd+Shift+R', 'hard refresh shortcut parsed', `saw ${intent.combo}`);
      assert(intent.appQuery === 'Chrome', 'hard refresh app parsed', `saw ${intent.appQuery}`);
    },
    'run_computer_task',
  );
  assertExtraIntent(
    'check the Remember me checkbox in Safari',
    'semantic_click',
    (intent) => {
      assert(intent.targetLabel === 'Remember me', 'checkbox target parsed', `saw ${intent.targetLabel}`);
      assert(intent.appQuery === 'Safari', 'checkbox app parsed', `saw ${intent.appQuery}`);
    },
    'run_computer_task',
  );
  assertExtraIntent(
    'wait one second',
    'wait',
    (intent) => {
      assert(intent.durationMs === 1000, 'word-number wait parsed', `saw ${intent.durationMs}`);
    },
    'run_computer_task',
  );
  assertExtraIntent(
    'hold mouse down at 100,200',
    'mouse_down',
    (intent) => {
      assert(intent.x === 100 && intent.y === 200, 'mouse down coords parsed', `saw ${intent.x},${intent.y}`);
    },
    'run_computer_task',
  );
  assertExtraIntent(
    'release mouse at 120,220',
    'mouse_up',
    (intent) => {
      assert(intent.x === 120 && intent.y === 220, 'mouse up coords parsed', `saw ${intent.x},${intent.y}`);
    },
    'run_computer_task',
  );
  assertExtraIntent(
    'drag from 100,200 to 600,700',
    'mouse_drag',
    (intent) => {
      assert(intent.fromX === 100 && intent.fromY === 200, 'drag start parsed', `saw ${intent.fromX},${intent.fromY}`);
      assert(intent.toX === 600 && intent.toY === 700, 'drag end parsed', `saw ${intent.toX},${intent.toY}`);
    },
    'run_computer_task',
  );
  const appSequence = detectLocalComputerAwarenessIntentSequence('open TextEdit then type "hello" then press Command S');
  assert(appSequence.length === 3, 'multi-step desktop sequence parsed', `saw ${appSequence.length} steps`);
  assert(appSequence[1]?.kind === 'type_text' && appSequence[1]?.appQuery === 'TextEdit', 'sequence carries app context to type step');
  assert(appSequence[2]?.kind === 'press_keys' && appSequence[2]?.appQuery === 'TextEdit', 'sequence carries app context to key step');

  assertSequence(
    'first open TextEdit; wait 1 second; fill the title field with Draft One; click File > Save; take a screenshot',
    (sequence) => {
      assert(sequence.length === 5, 'semicolon/first/final screenshot sequence length', `saw ${sequence.length}`);
      assert(sequence[0]?.kind === 'launch_app' && sequence[0]?.appQuery === 'TextEdit', 'sequence: first launch parsed');
      assert(sequence[1]?.kind === 'wait' && sequence[1]?.durationMs === 1000, 'sequence: wait step parsed', `saw ${sequence[1]?.durationMs}`);
      assert(sequence[2]?.kind === 'set_field_text' && sequence[2]?.targetLabel === 'title' && sequence[2]?.appQuery === 'TextEdit', 'sequence: field fill inherited app');
      assert(sequence[3]?.kind === 'menu_click' && sequence[3]?.appQuery === 'TextEdit', 'sequence: bare menu inherited app');
      assert(sequence[4]?.kind === 'screen_state', 'sequence: screenshot step parsed', `saw ${sequence[4]?.kind}`);
    },
  );

  assertSequence(
    '1. open TextEdit 2. type "hello numbered" 3. press Command S',
    (sequence) => {
      assert(sequence.length === 3, 'numbered inline sequence length', `saw ${sequence.length}`);
      assert(sequence[1]?.kind === 'type_text' && sequence[1]?.appQuery === 'TextEdit', 'numbered sequence carries app to type');
      assert(sequence[2]?.kind === 'press_keys' && sequence[2]?.appQuery === 'TextEdit', 'numbered sequence carries app to key');
    },
  );

  assertSequence(
    'open TextEdit, type "comma chain", and press Command S',
    (sequence) => {
      assert(sequence.length === 3, 'comma/and sequence length', `saw ${sequence.length}`);
      assert(sequence[1]?.kind === 'type_text' && sequence[1]?.text === 'comma chain', 'comma sequence type parsed', `saw ${sequence[1]?.text}`);
      assert(sequence[2]?.kind === 'press_keys' && sequence[2]?.appQuery === 'TextEdit', 'comma sequence key inherits app');
    },
  );

  assertSequence(
    'open TextEdit then show clickable elements then click the Save button',
    (sequence) => {
      assert(sequence.length === 3, 'a11y sequence length', `saw ${sequence.length}`);
      assert(sequence[1]?.kind === 'a11y_tree' && sequence[1]?.appQuery === 'TextEdit', 'a11y sequence inherits app');
      assert(sequence[2]?.kind === 'semantic_click' && sequence[2]?.appQuery === 'TextEdit', 'semantic click after a11y inherits app');
    },
  );

  assertSequence(
    'open ~/Downloads; take a screenshot',
    (sequence) => {
      assert(sequence.length === 2, 'open path screenshot sequence length', `saw ${sequence.length}`);
      assert(sequence[0]?.kind === 'open_path' && sequence[0]?.path === '~/Downloads', 'sequence: open path parsed', `saw ${sequence[0]?.path}`);
      assert(sequence[1]?.kind === 'screen_state', 'sequence: screenshot after open path parsed');
    },
  );

  assertSequence(
    'open Photoshop then open a new document then paste clipboard then save as then close window',
    (sequence) => {
      assert(sequence.length === 5, 'natural app shortcut sequence length', `saw ${sequence.length}`);
      assert(sequence[0]?.kind === 'launch_app' && sequence[0]?.appQuery === 'Photoshop', 'shortcut sequence launches app');
      assert(sequence[1]?.kind === 'press_keys' && sequence[1]?.combo === 'Cmd+N' && sequence[1]?.appQuery === 'Photoshop', 'shortcut sequence new document inherits app');
      assert(sequence[2]?.kind === 'press_keys' && sequence[2]?.combo === 'Cmd+V' && sequence[2]?.appQuery === 'Photoshop', 'shortcut sequence paste inherits app');
      assert(sequence[3]?.kind === 'press_keys' && sequence[3]?.combo === 'Cmd+Shift+S' && sequence[3]?.appQuery === 'Photoshop', 'shortcut sequence save-as inherits app');
      assert(sequence[4]?.kind === 'press_keys' && sequence[4]?.combo === 'Cmd+W' && sequence[4]?.appQuery === 'Photoshop', 'shortcut sequence close window inherits app');
    },
  );

  assertSequence(
    'open Photoshop then inspect layers then export as ~/Desktop/proof.jpg',
    (sequence) => {
      assert(sequence.length === 3, 'Photoshop bridge tool sequence length', `saw ${sequence.length}`);
      assert(sequence[0]?.kind === 'launch_app' && sequence[0]?.appQuery === 'Photoshop', 'Photoshop tool sequence launches app');
      assert(sequence[1]?.kind === 'photoshop_layer_inventory' && sequence[1]?.appQuery === 'Photoshop', 'Photoshop tool sequence inspects layers through bridge');
      assert(sequence[2]?.kind === 'photoshop_export_proof' && sequence[2]?.outputPath === '~/Desktop/proof.jpg' && sequence[2]?.format === 'jpg', 'Photoshop tool sequence exports proof through bridge');
    },
  );

  assertSequence(
    'open Photoshop then hide layer Legal',
    (sequence) => {
      const layerStep = sequence.find((step) => step.kind === 'photoshop_set_layer_state');
      assert(layerStep?.targetLabel === 'Legal', 'photoshop hide layer target parsed', `saw ${layerStep?.targetLabel}`);
      assert(layerStep?.layerStateAction === 'hide', 'photoshop hide layer action parsed', `saw ${layerStep?.layerStateAction}`);
      assert(layerStep?.reason === 'local-photoshop-set-layer-state', 'photoshop layer state routes to bridge tool', layerStep?.reason);
    },
  );

  assertSequence(
    'Open Photoshop and save the image as test-it.jpg',
    (sequence) => {
      assert(sequence.length === 7, 'save-image-as sequence length', `saw ${sequence.length}`);
      assert(sequence[0]?.kind === 'launch_app' && sequence[0]?.appQuery === 'Photoshop', 'save-image-as launches Photoshop');
      assert(sequence[1]?.kind === 'press_keys' && sequence[1]?.combo === 'Cmd+Opt+Shift+S' && sequence[1]?.appQuery === 'Photoshop', 'save-image-as opens Photoshop Save for Web for image files');
      assert(sequence[2]?.kind === 'wait' && sequence[2]?.durationMs === 1500, 'save-image-as waits for Save for Web dialog', `saw ${sequence[2]?.durationMs}`);
      assert(sequence[3]?.kind === 'semantic_click' && sequence[3]?.targetLabel === 'Save' && sequence[3]?.reason === 'local-save-for-web-save-button' && sequence[3]?.appQuery === 'Photoshop', 'save-image-as clicks verified Save for Web save button');
      assert(sequence[4]?.kind === 'wait' && sequence[4]?.durationMs === 1000, 'save-image-as waits for filename dialog', `saw ${sequence[4]?.durationMs}`);
      assert(sequence[5]?.kind === 'paste_text' && sequence[5]?.text === 'test-it.jpg' && sequence[5]?.appQuery === 'Photoshop' && sequence[5]?.reason === 'local-save-dialog-output-path', 'save-image-as verifies and sets output path');
      assert(sequence[6]?.kind === 'press_keys' && sequence[6]?.combo === 'Return' && sequence[6]?.appQuery === 'Photoshop', 'save-image-as confirms dialog');
      const preview = planComputerTaskPreview('Open Photoshop and save the image as test-it.jpg');
      assert(preview.kind === 'app_task', 'save-image-as previews as app workflow when no exact input file is named', `saw ${preview.kind}`);
      assert(preview.label === 'Deterministic desktop sequence', 'save-image-as preview labels desktop sequence', `saw ${preview.label}`);
      assert(preview.requiredCapabilities.includes('app_tools'), 'save-image-as preview requires app tools');
      assert(preview.requiredCapabilities.includes('file_write'), 'save-image-as preview requires bounded output write');
    },
  );

  assertSequence(
    PHOTOSHOP_SCREENSHOT_RENAME_REQUEST,
    (sequence) => {
      const openStep = sequence[0];
      const exportStep = sequence.find((step) => step.kind === 'photoshop_export_proof');
      const saveForWebStep = sequence.find((step) => step.kind === 'press_keys' && step.combo === 'Cmd+Opt+Shift+S');
      const saveButtonStep = sequence.find((step) => step.kind === 'semantic_click' && step.reason === 'local-save-for-web-save-button');
      const filenameStep = sequence.find((step) => step.kind === 'paste_text' && step.reason === 'local-save-dialog-output-path');
      assert(openStep?.kind === 'open_file_search_match', 'photoshop screenshot workflow searches and opens the named file', `saw ${openStep?.kind}`);
      assert(openStep?.query === 'Screenshot 2026-05-21 at 4.44.42 PM', 'photoshop screenshot workflow preserves screenshot filename query', `saw ${openStep?.query}`);
      assert(openStep?.rootPath === '~/Desktop', 'photoshop screenshot workflow targets Desktop', `saw ${openStep?.rootPath}`);
      assert(openStep?.appQuery === 'Photoshop', 'photoshop screenshot workflow opens matched file in Photoshop', `saw ${openStep?.appQuery}`);
      assert(openStep?.extensions?.includes('png') && !openStep?.extensions?.includes('44'), 'photoshop screenshot workflow treats time dots as filename text, not an extension', `saw ${openStep?.extensions?.join(',')}`);
      assert(!exportStep, 'photoshop screenshot workflow avoids stale proof endpoint and uses Save for Web');
      assert(saveForWebStep?.appQuery === 'Photoshop', 'photoshop screenshot workflow opens Save for Web in Photoshop');
      assert(saveButtonStep?.appQuery === 'Photoshop', 'photoshop screenshot workflow clicks verified Save for Web button');
      assert(filenameStep?.text === '~/Desktop/lmao.png' && filenameStep?.appQuery === 'Photoshop', 'photoshop screenshot workflow saves renamed PNG to Desktop', `saw ${filenameStep?.text}`);
      const preview = planComputerTaskPreview(PHOTOSHOP_SCREENSHOT_RENAME_REQUEST);
      const grants = buildComputerTaskGrantPlan({
        task: PHOTOSHOP_SCREENSHOT_RENAME_REQUEST,
        preview,
        audit: null,
        grantedIds: [],
      });
      const fileWriteGrant = grants.grants.find((grant) => grant.id === 'file_write');
      const fileReadGrant = grants.grants.find((grant) => grant.id === 'file_read');
      const appActionGrant = grants.grants.find((grant) => grant.id === 'app_action');
      assert(fileReadGrant && fileReadGrant.approvalRequired === false, 'photoshop screenshot workflow auto-prepares file read access without separate approval');
      assert(fileWriteGrant && fileWriteGrant.approvalRequired === false, 'photoshop screenshot workflow auto-prepares file write access without separate approval');
      assert(appActionGrant && appActionGrant.approvalRequired === true, 'photoshop screenshot workflow requires approval for rename/export app actions');
      const directIntent = detectLocalComputerAwarenessIntent(PHOTOSHOP_SCREENSHOT_RENAME_REQUEST);
      assert(directIntent.kind !== 'screen_state' && directIntent.kind !== 'launch_app', 'photoshop screenshot filename does not downgrade to screen-state or bogus app-launch intent', `saw ${directIntent.kind}`);
    },
  );

  assertSequence(
    'Open Photoshop and resize image to 1200x800',
    (sequence) => {
      assert(sequence.length === 6, 'photoshop resize image sequence length', `saw ${sequence.length}`);
      assert(sequence[0]?.kind === 'launch_app' && sequence[0]?.appQuery === 'Photoshop', 'photoshop resize launches Photoshop');
      assert(sequence[1]?.kind === 'menu_click' && sequence[1]?.menuPath?.join(' > ') === 'Image > Image Size...' && sequence[1]?.appQuery === 'Photoshop', 'photoshop resize opens Image Size');
      assert(sequence[3]?.kind === 'set_field_text' && sequence[3]?.targetLabel === 'Width' && sequence[3]?.text === '1200', 'photoshop resize sets width');
      assert(sequence[4]?.kind === 'set_field_text' && sequence[4]?.targetLabel === 'Height' && sequence[4]?.text === '800', 'photoshop resize sets height');
      assert(sequence[5]?.kind === 'press_keys' && sequence[5]?.combo === 'Return', 'photoshop resize confirms dialog');
    },
  );

  assertSequence(
    'Open Photoshop and select subject',
    (sequence) => {
      assert(sequence.length === 3, 'photoshop select subject sequence length', `saw ${sequence.length}`);
      assert(sequence[1]?.kind === 'menu_click' && sequence[1]?.menuPath?.join(' > ') === 'Select > Subject' && sequence[1]?.appQuery === 'Photoshop', 'photoshop select subject opens menu');
      assert(sequence[2]?.kind === 'wait' && sequence[2]?.durationMs === 1200, 'photoshop select subject waits for selection');
    },
  );

  assertSequence(
    'Open Photoshop and remove background',
    (sequence) => {
      assert(sequence.length === 4, 'photoshop remove background sequence length', `saw ${sequence.length}`);
      assert(sequence[1]?.kind === 'menu_click' && sequence[1]?.menuPath?.join(' > ') === 'Select > Subject' && sequence[1]?.appQuery === 'Photoshop', 'photoshop remove background selects subject first');
      assert(sequence[3]?.kind === 'semantic_click' && sequence[3]?.targetLabel === 'Remove Background' && sequence[3]?.appQuery === 'Photoshop', 'photoshop remove background clicks quick action');
    },
  );

  assertSequence(
    'Open Photoshop and use generative fill to add red flowers',
    (sequence) => {
      assert(sequence.length === 6, 'photoshop generative fill sequence length', `saw ${sequence.length}`);
      assert(sequence[1]?.kind === 'menu_click' && sequence[1]?.menuPath?.join(' > ') === 'Edit > Generative Fill...' && sequence[1]?.appQuery === 'Photoshop', 'photoshop generative fill opens menu');
      assert(sequence[3]?.kind === 'paste_text' && sequence[3]?.text === 'red flowers' && sequence[3]?.reason === 'local-photoshop-ai-prompt', 'photoshop generative fill pastes prompt');
      assert(sequence[4]?.kind === 'semantic_click' && sequence[4]?.targetLabel === 'Generate', 'photoshop generative fill clicks Generate');
    },
  );

  assertSequence(
    'Open Photoshop and generate image of a neon swan logo',
    (sequence) => {
      assert(sequence.length === 10, 'photoshop generate image sequence length', `saw ${sequence.length}`);
      assert(sequence[1]?.kind === 'press_keys' && sequence[1]?.combo === 'Cmd+N' && sequence[1]?.appQuery === 'Photoshop', 'photoshop generate image opens new document');
      assert(sequence[3]?.kind === 'semantic_click' && sequence[3]?.targetLabel === 'Create' && sequence[3]?.appQuery === 'Photoshop', 'photoshop generate image creates default document');
      assert(sequence[5]?.kind === 'semantic_click' && sequence[5]?.targetLabel === 'Generate Image', 'photoshop generate image opens Generate Image');
      assert(sequence[7]?.kind === 'paste_text' && sequence[7]?.text === 'a neon swan logo', 'photoshop generate image pastes prompt');
      assert(sequence[8]?.kind === 'semantic_click' && sequence[8]?.targetLabel === 'Generate', 'photoshop generate image clicks Generate');
    },
  );

  assertSequence(
    'Open Photoshop and use content-aware fill',
    (sequence) => {
      assert(sequence.length === 4, 'photoshop content-aware fill sequence length', `saw ${sequence.length}`);
      assert(sequence[1]?.kind === 'menu_click' && sequence[1]?.menuPath?.join(' > ') === 'Edit > Content-Aware Fill...' && sequence[1]?.appQuery === 'Photoshop', 'photoshop content-aware fill opens menu');
      assert(sequence[3]?.kind === 'semantic_click' && sequence[3]?.targetLabel === 'OK', 'photoshop content-aware fill confirms');
    },
  );

  assertSequence(
    'generative fill with blue sky in Photoshop',
    (sequence) => {
      assert(sequence.length === 6, 'standalone photoshop generative fill sequence length', `saw ${sequence.length}`);
      assert(sequence[0]?.kind === 'focus_app' && sequence[0]?.appQuery === 'Photoshop', 'standalone photoshop macro focuses Photoshop');
      assert(sequence[1]?.kind === 'menu_click' && sequence[1]?.appQuery === 'Photoshop', 'standalone photoshop macro targets Photoshop');
      assert(sequence[3]?.kind === 'paste_text' && sequence[3]?.text === 'blue sky', 'standalone photoshop macro prompt parsed');
    },
  );

  assertSequence(
    'Open Photoshop and add curves adjustment layer',
    (sequence) => {
      assert(sequence.length === 4, 'photoshop curves sequence length', `saw ${sequence.length}`);
      assert(sequence[1]?.kind === 'menu_click' && sequence[1]?.menuPath?.join(' > ') === 'Layer > New Adjustment Layer > Curves...' && sequence[1]?.appQuery === 'Photoshop', 'photoshop curves opens adjustment layer menu');
      assert(sequence[3]?.kind === 'press_keys' && sequence[3]?.combo === 'Return', 'photoshop curves confirms dialog');
    },
  );

  assertSequence(
    'Open Photoshop and convert layer to smart object',
    (sequence) => {
      assert(sequence.length === 2, 'photoshop smart object sequence length', `saw ${sequence.length}`);
      assert(sequence[1]?.kind === 'menu_click' && sequence[1]?.menuPath?.join(' > ') === 'Layer > Smart Objects > Convert to Smart Object' && sequence[1]?.appQuery === 'Photoshop', 'photoshop smart object menu parsed');
    },
  );

  assertSequence(
    'Open Photoshop and open select and mask',
    (sequence) => {
      assert(sequence.length === 2, 'photoshop select and mask sequence length', `saw ${sequence.length}`);
      assert(sequence[1]?.kind === 'menu_click' && sequence[1]?.menuPath?.join(' > ') === 'Select > Select and Mask...' && sequence[1]?.appQuery === 'Photoshop', 'photoshop select and mask menu parsed');
    },
  );

  assertSequence(
    'Open Photoshop and use gaussian blur',
    (sequence) => {
      assert(sequence.length === 2, 'photoshop gaussian blur sequence length', `saw ${sequence.length}`);
      assert(sequence[1]?.kind === 'menu_click' && sequence[1]?.menuPath?.join(' > ') === 'Filter > Blur > Gaussian Blur...' && sequence[1]?.appQuery === 'Photoshop', 'photoshop gaussian blur menu parsed');
    },
  );

  assertSequence(
    'Open Photoshop and open ~/Desktop/source.png',
    (sequence) => {
      assert(sequence.some((step) => step.kind === 'menu_click' && step.menuPath?.join(' > ') === 'File > Open...' && step.appQuery === 'Photoshop'), 'photoshop open local file menu parsed');
      assert(sequence.some((step) => step.kind === 'paste_text' && step.text === '~/Desktop/source.png' && step.appQuery === 'Photoshop'), 'photoshop open local file path parsed');
    },
  );

  assertSequence(
    'Open Photoshop and place ~/Desktop/logo.png as linked',
    (sequence) => {
      assert(sequence.length === 2, 'photoshop place asset bridge sequence length', `saw ${sequence.length}`);
      assert(sequence[1]?.kind === 'photoshop_place_asset' && sequence[1]?.assetPath === '~/Desktop/logo.png' && sequence[1]?.appQuery === 'Photoshop', 'photoshop place asset uses bridge tool');
    },
  );

  assertSequence(
    'Open Photoshop and create a clipping mask',
    (sequence) => {
      assert(sequence.some((step) => step.kind === 'menu_click' && step.menuPath?.join(' > ') === 'Layer > Create Clipping Mask' && step.appQuery === 'Photoshop'), 'photoshop clipping mask menu parsed');
    },
  );

  assertSequence(
    'Open Photoshop and run image processor',
    (sequence) => {
      assert(sequence.some((step) => step.kind === 'menu_click' && step.menuPath?.join(' > ') === 'File > Scripts > Image Processor...' && step.appQuery === 'Photoshop'), 'photoshop image processor menu parsed');
    },
  );

  assertSequence(
    'Open Photoshop and convert image mode to CMYK',
    (sequence) => {
      assert(sequence.some((step) => step.kind === 'menu_click' && step.menuPath?.join(' > ') === 'Image > Mode > CMYK Color' && step.appQuery === 'Photoshop'), 'photoshop CMYK mode menu parsed');
    },
  );

  assertSequence(
    'Open InDesign and place ~/Desktop/logo.png',
    (sequence) => {
      assert(sequence.length === 9, 'indesign place file sequence length', `saw ${sequence.length}`);
      assert(sequence[0]?.kind === 'launch_app' && sequence[0]?.appQuery === 'InDesign', 'indesign place launches InDesign');
      assert(sequence[1]?.kind === 'menu_click' && sequence[1]?.menuPath?.join(' > ') === 'File > Place...' && sequence[1]?.appQuery === 'InDesign', 'indesign place opens File Place');
      assert(sequence[3]?.kind === 'press_keys' && sequence[3]?.combo === 'Cmd+Shift+G' && sequence[3]?.appQuery === 'InDesign', 'indesign place opens go-to-path dialog');
      assert(sequence[5]?.kind === 'paste_text' && sequence[5]?.text === '~/Desktop/logo.png' && sequence[5]?.appQuery === 'InDesign', 'indesign place pastes path');
    },
  );

  assertSequence(
    'Open InDesign and export as brochure.pdf',
    (sequence) => {
      assert(sequence.length === 7, 'indesign export sequence length', `saw ${sequence.length}`);
      assert(sequence[1]?.kind === 'menu_click' && sequence[1]?.menuPath?.join(' > ') === 'File > Export...' && sequence[1]?.appQuery === 'InDesign', 'indesign export opens File Export');
      assert(sequence[3]?.kind === 'paste_text' && sequence[3]?.text === 'brochure.pdf' && sequence[3]?.reason === 'local-save-dialog-filename', 'indesign export sets filename');
      assert(sequence[6]?.kind === 'semantic_click' && sequence[6]?.targetLabel === 'Export' && sequence[6]?.appQuery === 'InDesign', 'indesign export confirms export options');
    },
  );

  assertSequence(
    'Open InDesign and prep banner workflow',
    (sequence) => {
      assert(sequence.length === 9, 'indesign banner workflow sequence length', `saw ${sequence.length}`);
      assert(sequence[0]?.kind === 'launch_app' && sequence[0]?.appQuery === 'InDesign', 'indesign banner workflow launches InDesign');
      assert(sequence.some((step) => step.kind === 'menu_click' && step.menuPath?.join(' > ') === 'Window > Layers' && step.appQuery === 'InDesign'), 'indesign banner workflow opens Layers');
      assert(sequence.some((step) => step.kind === 'menu_click' && step.menuPath?.join(' > ') === 'Window > Utilities > Data Merge' && step.appQuery === 'InDesign'), 'indesign banner workflow opens Data Merge');
      assert(sequence.some((step) => step.kind === 'menu_click' && step.menuPath?.join(' > ') === 'Window > Output > Preflight' && step.appQuery === 'InDesign'), 'indesign banner workflow opens Preflight');
    },
  );

  assertSequence(
    'Open InDesign and show object layer options for selected graphic',
    (sequence) => {
      assert(sequence.length === 3, 'indesign object layer options sequence length', `saw ${sequence.length}`);
      assert(sequence[1]?.kind === 'menu_click' && sequence[1]?.menuPath?.join(' > ') === 'Object > Object Layer Options...' && sequence[1]?.appQuery === 'InDesign', 'indesign object layer options menu parsed');
    },
  );

  assertSequence(
    'Open InDesign and switch placed layer to Holiday Variant',
    (sequence) => {
      assert(sequence.some((step) => step.kind === 'menu_click' && step.menuPath?.join(' > ') === 'Object > Object Layer Options...' && step.appQuery === 'InDesign'), 'indesign placed layer variant opens Object Layer Options');
      assert(sequence.some((step) => step.kind === 'semantic_click' && step.targetLabel === 'Holiday Variant' && step.appQuery === 'InDesign'), 'indesign placed layer variant target parsed');
      assert(sequence.some((step) => step.kind === 'semantic_click' && step.targetLabel === 'OK' && step.appQuery === 'InDesign'), 'indesign placed layer variant confirms dialog');
    },
  );

  assertSequence(
    'Open InDesign and set selected banner headline to Spring Sale',
    (sequence) => {
      assert(sequence.length === 4, 'indesign banner text sequence length', `saw ${sequence.length}`);
      assert(sequence[1]?.kind === 'press_keys' && sequence[1]?.combo === 'T' && sequence[1]?.appQuery === 'InDesign', 'indesign banner text selects Type tool');
      assert(sequence[3]?.kind === 'paste_text' && sequence[3]?.text === 'Spring Sale' && /local-indesign-(?:banner|dealer-banner)-text/.test(sequence[3]?.reason || ''), 'indesign banner text replacement parsed');
    },
  );

  assertSequence(
    'Open InDesign file ~/Desktop/honda-banner.indd',
    (sequence) => {
      assert(sequence[0]?.kind === 'open_path' && sequence[0]?.path === '~/Desktop/honda-banner.indd', 'indesign open file path parsed');
      assert(sequence.some((step) => step.kind === 'wait_for_app' && step.appQuery === 'InDesign'), 'indesign open waits for InDesign');
      assert(sequence.some((step) => step.kind === 'focus_app' && step.appQuery === 'InDesign'), 'indesign open focuses InDesign');
    },
  );

  assertSequence(
    'Open ~/Desktop/honda-banner.indd and change disclaimer to See dealer for details',
    (sequence) => {
      assert(sequence[0]?.kind === 'open_path' && sequence[0]?.path === '~/Desktop/honda-banner.indd', 'indesign open then edit opens file path first');
      assert(sequence.some((step) => step.kind === 'indesign_update_text_layer' && step.targetLabel === 'disclaimer' && step.text === 'See dealer for details' && step.appQuery === 'InDesign'), 'indesign open then edit uses script-backed Disclaimer text layer update');
    },
  );

  assertSequence(
    'Find honda-banner.indd on my desktop and update APR to 2.9% for 72 months',
    (sequence) => {
      assert(sequence[0]?.kind === 'open_file_search_match' && sequence[0]?.query === 'honda-banner.indd' && sequence[0]?.rootPath === '~/Desktop', 'indesign file search open parses desktop target');
      assert(sequence[0]?.extensions?.includes('indd'), 'indesign file search open restricts to indd');
      assert(sequence.some((step) => step.kind === 'indesign_update_text_layer' && step.targetLabel === 'APR' && step.text === '2.9% for 72 months' && step.appQuery === 'InDesign'), 'indesign file search then APR uses script-backed APR text layer update');
    },
  );

  assertSequence(
    'open Hyundai of Milledgeville Parts Specials 022026.indd in downloads and change 64 to 65',
    (sequence) => {
      assert(sequence[0]?.kind === 'open_file_search_match' && sequence[0]?.query === 'Hyundai of Milledgeville Parts Specials 022026.indd' && sequence[0]?.rootPath === '~/Downloads', 'indesign spaced downloads filename parsed');
      assert(sequence[0]?.extensions?.includes('indd'), 'indesign spaced downloads filename restricts to indd');
      assert(sequence.some((step) => step.kind === 'indesign_find_change' && step.query === '64' && step.text === '65' && step.appQuery === 'InDesign'), 'indesign simple numeric change uses script-backed Find/Change');
      const preview = planComputerTaskPreview('open Hyundai of Milledgeville Parts Specials 022026.indd in downloads and change 64 to 65');
      assert(preview.label === 'Deterministic desktop sequence', 'indesign spaced downloads task remains deterministic', `saw ${preview.label}`);
      assert(preview.requiredCapabilities.includes('file_search'), 'indesign spaced downloads task requires file search');
      assert(preview.requiredCapabilities.includes('file_read'), 'indesign spaced downloads task requires file read grant');
      assert(preview.requiredCapabilities.includes('app_tools'), 'indesign spaced downloads task requires app tools');
      const grants = buildComputerTaskGrantPlan({
        task: 'open Hyundai of Milledgeville Parts Specials 022026.indd in downloads and change 64 to 65',
        preview,
        audit: null,
        grantedIds: [],
      });
	      assert(grants.grants.some((grant) => grant.id === 'file_read' && grant.approvalRequired === false), 'indesign spaced downloads grant plan auto-prepares file read access');
	      assert(grants.grants.some((grant) => grant.id === 'app_action'), 'indesign spaced downloads grant plan requests app action approval');
    },
  );

  assertSequence(
    'open Hyundai of Milledgeville Parts Specials 022026.indd in downloads and change 64 to 65, 72 to 84',
    (sequence) => {
      assert(sequence[0]?.kind === 'open_file_search_match' && sequence[0]?.query === 'Hyundai of Milledgeville Parts Specials 022026.indd' && sequence[0]?.rootPath === '~/Downloads', 'indesign batch spaced downloads filename parsed');
      const batchStep = sequence.find((step) => step.kind === 'indesign_batch_find_change');
      assert(batchStep?.appQuery === 'InDesign', 'indesign batch change targets InDesign', `saw ${batchStep?.appQuery}`);
      assert(batchStep?.replacements?.length === 2, 'indesign batch change parses two replacements', `saw ${batchStep?.replacements?.length}`);
      assert(batchStep?.replacements?.[0]?.findText === '64' && batchStep?.replacements?.[0]?.changeText === '65', 'indesign batch first replacement parsed');
      assert(batchStep?.replacements?.[1]?.findText === '72' && batchStep?.replacements?.[1]?.changeText === '84', 'indesign batch second replacement parsed');
    },
  );

  assertSequence(
    'change 64 to 65, 72 to 84 in InDesign',
    (sequence) => {
      assert(sequence[0]?.kind === 'focus_app' && sequence[0]?.appQuery === 'InDesign', 'standalone indesign batch focuses InDesign first');
      const batchStep = sequence.find((step) => step.kind === 'indesign_batch_find_change');
      assert(batchStep?.replacements?.length === 2, 'standalone indesign batch parses compact replacement list', `saw ${batchStep?.replacements?.length}`);
      assert(batchStep?.replacements?.[0]?.findText === '64' && batchStep?.replacements?.[0]?.changeText === '65', 'standalone indesign batch first replacement parsed');
      assert(batchStep?.replacements?.[1]?.findText === '72' && batchStep?.replacements?.[1]?.changeText === '84', 'standalone indesign batch second replacement parsed');
    },
  );

  assertSequence(
    'check InDesign document status and missing links',
    (sequence) => {
      assert(sequence[0]?.kind === 'focus_app' && sequence[0]?.appQuery === 'InDesign', 'indesign status focuses InDesign first');
      assert(sequence.some((step) => step.kind === 'indesign_document_status' && step.appQuery === 'InDesign'), 'indesign status uses read-only script-backed document probe');
      const preview = planComputerTaskPreview('check InDesign document status and missing links');
      assert(preview.label === 'Deterministic desktop sequence', 'indesign status task remains deterministic', `saw ${preview.label}`);
      assert(preview.requiredCapabilities.includes('app_tools'), 'indesign status requires app tools');
    },
  );

  assertSequence(
    'show InDesign text frames and layer names',
    (sequence) => {
      assert(sequence[0]?.kind === 'focus_app' && sequence[0]?.appQuery === 'InDesign', 'indesign text inventory focuses InDesign first');
      assert(sequence.some((step) => step.kind === 'indesign_text_inventory' && step.appQuery === 'InDesign'), 'indesign text inventory uses read-only script-backed text frame probe');
      const preview = planComputerTaskPreview('show InDesign text frames and layer names');
      assert(preview.label === 'Deterministic desktop sequence', 'indesign text inventory task remains deterministic', `saw ${preview.label}`);
      assert(preview.requiredCapabilities.includes('app_tools'), 'indesign text inventory requires app tools');
    },
  );

  assertSequence(
    'Find "honda-banner" in my Google Drive and open it in InDesign and change disclaimer to See dealer for details',
    (sequence) => {
      assert(sequence[0]?.kind === 'open_file_search_match' && sequence[0]?.query === 'honda-banner' && sequence[0]?.rootPath === 'google_drive', 'google drive indesign workflow searches Drive sync roots');
      assert(sequence[0]?.extensions?.includes('indd'), 'google drive indesign workflow restricts to indd');
      assert(sequence.some((step) => step.kind === 'wait_for_app' && step.appQuery === 'InDesign'), 'google drive indesign workflow waits for InDesign');
      assert(sequence.some((step) => step.kind === 'indesign_update_text_layer' && step.targetLabel === 'disclaimer' && step.text === 'See dealer for details' && step.appQuery === 'InDesign'), 'google drive indesign workflow uses script-backed Disclaimer text layer update');
    },
  );

  assertSequence(
    'Find "honda-banner.indd" in Google Drive and open it in InDesign and replace "expires 5/31" with "expires 6/30"',
    (sequence) => {
      assert(sequence[0]?.kind === 'open_file_search_match' && sequence[0]?.query === 'honda-banner.indd' && sequence[0]?.rootPath === 'google_drive', 'google drive indesign find replace searches Drive');
      assert(sequence.some((step) => step.kind === 'indesign_find_change' && step.query === 'expires 5/31' && step.text === 'expires 6/30' && step.appQuery === 'InDesign'), 'google drive indesign find replace uses script-backed Change All');
    },
  );

  assertSequence(
    'Change disclaimer in honda-banner.indd to See dealer for complete details',
    (sequence) => {
      assert(sequence[0]?.kind === 'open_file_search_match' && sequence[0]?.query === 'honda-banner.indd', 'indesign in-file edit finds referenced document');
      assert(sequence.some((step) => step.kind === 'indesign_update_text_layer' && step.targetLabel === 'disclaimer' && step.text === 'See dealer for complete details' && step.appQuery === 'InDesign'), 'indesign in-file edit uses script-backed Disclaimer text layer update');
    },
  );

  assertSequence(
    'Replace "expires 5/31" with "expires 6/30" in honda-banner.indd',
    (sequence) => {
      assert(sequence[0]?.kind === 'open_file_search_match' && sequence[0]?.query === 'honda-banner.indd', 'indesign find replace finds referenced document');
      assert(sequence.some((step) => step.kind === 'indesign_find_change' && step.query === 'expires 5/31' && step.text === 'expires 6/30' && step.appQuery === 'InDesign'), 'indesign in-file find replace uses script-backed Change All');
    },
  );

  const indesignMenuRecovery = buildInDesignRecoveryCandidatesForIntent({
    route: true,
    kind: 'menu_click',
    appQuery: 'InDesign',
    menuPath: ['Edit', 'Find/Change...'],
    reason: 'local-indesign-dealer-find-change',
  });
  assert(indesignMenuRecovery.some((candidate) => candidate.menuPath?.join(' > ') === 'Edit > Find/Change'), 'indesign recovery adds menu label fallback');

  const indesignLayerRecovery = buildInDesignRecoveryCandidatesForIntent({
    route: true,
    kind: 'semantic_click',
    appQuery: 'InDesign',
    targetLabel: 'Disclaimer',
    reason: 'local-indesign-dealer-target-layer',
  });
  assert(indesignLayerRecovery.some((candidate) => candidate.targetLabel === 'Legal Copy'), 'indesign recovery adds dealership layer label fallback');

  const indesignFieldRecovery = buildInDesignRecoveryCandidatesForIntent({
    route: true,
    kind: 'set_field_text',
    appQuery: 'InDesign',
    targetLabel: 'Change to',
    text: 'expires 6/30',
    reason: 'local-indesign-dealer-find-change',
  });
  assert(indesignFieldRecovery.some((candidate) => candidate.targetLabel === 'Replace with'), 'indesign recovery adds field label fallback');

  assertSequence(
    'change disclaimer to See dealer for complete details',
    (sequence) => {
      assert(sequence.length === 2, 'indesign dealer disclaimer sequence length', `saw ${sequence.length}`);
      assert(sequence[0]?.kind === 'focus_app' && sequence[0]?.appQuery === 'InDesign', 'dealer disclaimer focuses open InDesign file');
      assert(sequence[1]?.kind === 'indesign_update_text_layer' && sequence[1]?.targetLabel === 'disclaimer' && sequence[1]?.text === 'See dealer for complete details', 'dealer disclaimer uses script-backed text layer update');
    },
  );

  assertSequence(
    'update APR to 2.9% for 72 months',
    (sequence) => {
      assert(sequence[0]?.kind === 'focus_app' && sequence[0]?.appQuery === 'InDesign', 'dealer APR focuses open InDesign file');
      assert(sequence.some((step) => step.kind === 'indesign_update_text_layer' && step.targetLabel === 'APR' && step.text === '2.9% for 72 months' && step.appQuery === 'InDesign'), 'dealer APR uses script-backed APR text layer update');
    },
  );

  assertSequence(
    'update sale price to $29,995',
    (sequence) => {
      assert(sequence[0]?.kind === 'focus_app' && sequence[0]?.appQuery === 'InDesign', 'dealer price focuses open InDesign file');
      assert(sequence.some((step) => step.kind === 'indesign_update_text_layer' && step.targetLabel === 'sale price' && step.text === '$29,995' && step.appQuery === 'InDesign'), 'dealer price uses script-backed Price text layer update');
    },
  );

  assertSequence(
    'replace "expires 5/31/2026" with "expires 6/30/2026" in InDesign',
    (sequence) => {
      assert(sequence.length === 2, 'indesign dealer find replace sequence length', `saw ${sequence.length}`);
      assert(sequence[0]?.kind === 'focus_app' && sequence[0]?.appQuery === 'InDesign', 'dealer find replace focuses InDesign');
      assert(sequence[1]?.kind === 'indesign_find_change' && sequence[1]?.query === 'expires 5/31/2026' && sequence[1]?.text === 'expires 6/30/2026', 'dealer find replace uses script-backed Change All');
    },
  );

  assertSequence(
    'prep dealership banner for legal review',
    (sequence) => {
      assert(sequence.length === 10, 'indesign dealership proof sequence length', `saw ${sequence.length}`);
      assert(sequence[0]?.kind === 'focus_app' && sequence[0]?.appQuery === 'InDesign', 'dealership proof focuses InDesign');
      assert(sequence.some((step) => step.kind === 'menu_click' && step.menuPath?.join(' > ') === 'Window > Output > Preflight' && step.appQuery === 'InDesign'), 'dealership proof opens Preflight');
      assert(sequence.some((step) => step.kind === 'menu_click' && step.menuPath?.join(' > ') === 'Edit > Find/Change...' && step.appQuery === 'InDesign'), 'dealership proof opens Find/Change');
    },
  );

  assertSequence(
    'Open InDesign and replace selected banner image with ~/Desktop/hero.png',
    (sequence) => {
      assert(sequence.length === 2, 'indesign banner asset bridge sequence length', `saw ${sequence.length}`);
      assert((sequence[0]?.kind === 'launch_app' || sequence[0]?.kind === 'focus_app') && sequence[0]?.appQuery === 'InDesign', 'indesign banner asset opens InDesign');
      assert(sequence[1]?.kind === 'indesign_relink_asset' && sequence[1]?.assetPath === '~/Desktop/hero.png' && sequence[1]?.appQuery === 'InDesign', 'indesign banner asset uses bridge relink');
    },
  );

  assertSequence(
    'Open InDesign and set up variable banners with data merge',
    (sequence) => {
      assert(sequence.length === 7, 'indesign variable banners sequence length', `saw ${sequence.length}`);
      assert(sequence.some((step) => step.kind === 'menu_click' && step.menuPath?.join(' > ') === 'Window > Utilities > Data Merge' && step.appQuery === 'InDesign'), 'indesign variable banners opens Data Merge');
      assert(sequence.some((step) => step.kind === 'menu_click' && step.menuPath?.join(' > ') === 'Window > Pages' && step.appQuery === 'InDesign'), 'indesign variable banners opens Pages');
    },
  );

  assertSequence(
    'Open InDesign and export selected banner as banner.jpg',
    (sequence) => {
      assert(sequence.length === 7, 'indesign banner export sequence length', `saw ${sequence.length}`);
      assert(sequence[1]?.kind === 'menu_click' && sequence[1]?.menuPath?.join(' > ') === 'File > Export...' && sequence[1]?.appQuery === 'InDesign', 'indesign banner export opens File Export');
      assert(sequence[3]?.kind === 'paste_text' && sequence[3]?.text === 'banner.jpg' && sequence[3]?.reason === 'local-save-dialog-filename', 'indesign banner export filename parsed');
    },
  );

  assertSequence(
    'Open InDesign and select layer Hero Image',
    (sequence) => {
      assert(sequence.length === 4, 'indesign select layer sequence length', `saw ${sequence.length}`);
      assert(sequence[1]?.kind === 'menu_click' && sequence[1]?.menuPath?.join(' > ') === 'Window > Layers' && sequence[1]?.appQuery === 'InDesign', 'indesign select layer opens Layers');
      assert(sequence[3]?.kind === 'semantic_click' && sequence[3]?.targetLabel === 'Hero Image' && sequence[3]?.appQuery === 'InDesign', 'indesign select layer target parsed');
    },
  );

  assertSequence(
    'Open InDesign and move selected object to layer CTA',
    (sequence) => {
      assert(sequence.length === 7, 'indesign move selection to layer sequence length', `saw ${sequence.length}`);
      assert(sequence[3]?.kind === 'press_keys' && sequence[3]?.combo === 'Cmd+X' && sequence[3]?.appQuery === 'InDesign', 'indesign move selection cuts selected object');
      assert(sequence[4]?.kind === 'semantic_click' && sequence[4]?.targetLabel === 'CTA' && sequence[4]?.appQuery === 'InDesign', 'indesign move selection targets layer');
      assert(sequence[6]?.kind === 'press_keys' && sequence[6]?.combo === 'Cmd+Opt+Shift+V' && sequence[6]?.appQuery === 'InDesign', 'indesign move selection pastes in place');
    },
  );

  assertSequence(
    'Open InDesign and insert 3 pages',
    (sequence) => {
      assert(sequence.length === 5, 'indesign insert pages sequence length', `saw ${sequence.length}`);
      assert(sequence[1]?.kind === 'menu_click' && sequence[1]?.menuPath?.join(' > ') === 'Layout > Pages > Insert Pages...' && sequence[1]?.appQuery === 'InDesign', 'indesign insert pages opens menu');
      assert(sequence[3]?.kind === 'set_field_text' && sequence[3]?.targetLabel === 'Pages' && sequence[3]?.text === '3', 'indesign insert pages sets count');
    },
  );

  assertSequence(
    'Open InDesign and fit content proportionally',
    (sequence) => {
      assert(sequence.length === 2, 'indesign fitting sequence length', `saw ${sequence.length}`);
      assert(sequence[1]?.kind === 'menu_click' && sequence[1]?.menuPath?.join(' > ') === 'Object > Fitting > Fit Content Proportionally' && sequence[1]?.appQuery === 'InDesign', 'indesign fitting menu parsed');
    },
  );

  assertSequence(
    'Open InDesign and package document',
    (sequence) => {
      assert(sequence.length === 3, 'indesign package sequence length', `saw ${sequence.length}`);
      assert((sequence[0]?.kind === 'launch_app' || sequence[0]?.kind === 'focus_app') && sequence[0]?.appQuery === 'InDesign', 'indesign package opens InDesign');
      assert(sequence[1]?.kind === 'indesign_document_status' && sequence[1]?.appQuery === 'InDesign', 'indesign package checks document status first');
      assert(sequence[2]?.kind === 'indesign_package_document' && sequence[2]?.outputFolderPath === '~/Desktop/indesign-package' && sequence[2]?.appQuery === 'InDesign', 'indesign package uses bridge package tool');
    },
  );

  assertSequence(
    'Open InDesign and show links panel',
    (sequence) => {
      assert(sequence.length === 2, 'indesign links panel sequence length', `saw ${sequence.length}`);
      assert(sequence[1]?.kind === 'menu_click' && sequence[1]?.menuPath?.join(' > ') === 'Window > Links' && sequence[1]?.appQuery === 'InDesign', 'indesign links panel menu parsed');
    },
  );

  assertSequence(
    'Open InDesign and create outlines',
    (sequence) => {
      assert(sequence.length === 2, 'indesign create outlines sequence length', `saw ${sequence.length}`);
      assert(sequence[1]?.kind === 'menu_click' && sequence[1]?.menuPath?.join(' > ') === 'Type > Create Outlines' && sequence[1]?.appQuery === 'InDesign', 'indesign create outlines menu parsed');
    },
  );

  assertSequence(
    'Open InDesign and export high quality pdf as brochure.pdf',
    (sequence) => {
      assert(sequence.some((step) => step.kind === 'menu_click' && step.menuPath?.join(' > ') === 'File > Adobe PDF Presets > High Quality Print...' && step.appQuery === 'InDesign'), 'indesign PDF preset menu parsed');
      assert(sequence.some((step) => step.kind === 'paste_text' && step.text === 'brochure.pdf' && step.appQuery === 'InDesign'), 'indesign PDF preset filename parsed');
    },
  );

  assertSequence(
    'Open InDesign and go to page 12',
    (sequence) => {
      assert(sequence.some((step) => step.kind === 'menu_click' && step.menuPath?.join(' > ') === 'Layout > Go to Page...' && step.appQuery === 'InDesign'), 'indesign go to page menu parsed');
      assert(sequence.some((step) => step.kind === 'paste_text' && step.text === '12' && step.appQuery === 'InDesign'), 'indesign go to page number parsed');
    },
  );

  assertSequence(
    'Open InDesign and find missing fonts',
    (sequence) => {
      assert(sequence.some((step) => step.kind === 'menu_click' && step.menuPath?.join(' > ') === 'Type > Find/Replace Font...' && step.appQuery === 'InDesign'), 'indesign find font menu parsed');
    },
  );

  assertSequence(
    'Open InDesign and show text wrap panel',
    (sequence) => {
      assert(sequence.some((step) => step.kind === 'menu_click' && step.menuPath?.join(' > ') === 'Window > Text Wrap' && step.appQuery === 'InDesign'), 'indesign text wrap panel parsed');
    },
  );

  assertSequence(
    'Open InDesign and create table of contents',
    (sequence) => {
      assert(sequence.some((step) => step.kind === 'menu_click' && step.menuPath?.join(' > ') === 'Layout > Table of Contents...' && step.appQuery === 'InDesign'), 'indesign table of contents menu parsed');
    },
  );

  assertSequence(
    'Open InDesign and apply paragraph style Disclaimer Small',
    (sequence) => {
      assert(sequence.some((step) => step.kind === 'menu_click' && step.menuPath?.join(' > ') === 'Window > Styles > Paragraph Styles' && step.appQuery === 'InDesign'), 'indesign paragraph style opens styles panel');
      assert(sequence.some((step) => step.kind === 'semantic_click' && step.targetLabel === 'Disclaimer Small' && step.appQuery === 'InDesign'), 'indesign paragraph style target parsed');
    },
  );

  assertSequence(
    'Open InDesign and resize selected banner to 300x250',
    (sequence) => {
      assert(sequence.some((step) => step.kind === 'menu_click' && step.menuPath?.join(' > ') === 'Window > Object & Layout > Transform' && step.appQuery === 'InDesign'), 'indesign resize opens Transform panel');
      assert(sequence.some((step) => step.kind === 'set_field_text' && step.targetLabel === 'W' && step.text === '300'), 'indesign resize width parsed');
      assert(sequence.some((step) => step.kind === 'set_field_text' && step.targetLabel === 'H' && step.text === '250'), 'indesign resize height parsed');
    },
  );

  assertSequence(
    'Open InDesign and align selected object to page center',
    (sequence) => {
      assert(sequence.some((step) => step.kind === 'menu_click' && step.menuPath?.join(' > ') === 'Window > Object & Layout > Align' && step.appQuery === 'InDesign'), 'indesign align opens Align panel');
      assert(sequence.some((step) => step.kind === 'semantic_click' && step.targetLabel === 'Align to Page'), 'indesign align targets page reference');
      assert(sequence.some((step) => step.kind === 'semantic_click' && step.targetLabel === 'Horizontal Align Center'), 'indesign align horizontal center parsed');
      assert(sequence.some((step) => step.kind === 'semantic_click' && step.targetLabel === 'Vertical Align Center'), 'indesign align vertical center parsed');
    },
  );

  assertSequence(
    'Open InDesign and relink selected image to ~/Desktop/new-hero.png',
    (sequence) => {
      assert(sequence.some((step) => step.kind === 'indesign_relink_asset' && step.assetPath === '~/Desktop/new-hero.png' && step.appQuery === 'InDesign'), 'indesign relink uses bridge asset relink tool');
    },
  );

  assertSequence(
    'Open InDesign and export proof pdf as dealer-proof.pdf',
    (sequence) => {
      assert(sequence.some((step) => step.kind === 'indesign_export_proof' && step.outputPath === 'dealer-proof.pdf' && step.format === 'pdf' && step.appQuery === 'InDesign'), 'indesign proof export uses bridge PDF proof tool');
    },
  );

  assertSequence(
    'Open InDesign and package document for handoff',
    (sequence) => {
      assert(sequence.some((step) => step.kind === 'indesign_document_status' && step.appQuery === 'InDesign'), 'indesign handoff package checks document status first');
      assert(sequence.some((step) => step.kind === 'indesign_package_document' && step.outputFolderPath === '~/Desktop/indesign-package' && step.appQuery === 'InDesign'), 'indesign handoff package uses bridge package tool');
    },
  );

  assertSequence(
    'Open InDesign and make selected text uppercase',
    (sequence) => {
      assert(sequence.some((step) => step.kind === 'menu_click' && step.menuPath?.join(' > ') === 'Type > Change Case > UPPERCASE' && step.appQuery === 'InDesign'), 'indesign uppercase menu parsed');
    },
  );

  assertSequence(
    'Open InDesign and place ~/Desktop/logo.png on layer Logos',
    (sequence) => {
      assert(sequence.some((step) => step.kind === 'semantic_click' && step.targetLabel === 'Logos' && step.appQuery === 'InDesign'), 'indesign place-on-layer target parsed');
      assert(sequence.some((step) => step.kind === 'menu_click' && step.menuPath?.join(' > ') === 'File > Place...' && step.appQuery === 'InDesign'), 'indesign place-on-layer opens Place');
      assert(sequence.some((step) => step.kind === 'paste_text' && step.text === '~/Desktop/logo.png' && step.appQuery === 'InDesign'), 'indesign place-on-layer path parsed');
    },
  );

  assertSequence(
    'Open InDesign and duplicate current spread',
    (sequence) => {
      assert(sequence.some((step) => step.kind === 'menu_click' && step.menuPath?.join(' > ') === 'Window > Pages' && step.appQuery === 'InDesign'), 'indesign duplicate spread opens Pages panel');
      assert(sequence.some((step) => step.kind === 'menu_click' && step.menuPath?.join(' > ') === 'Layout > Pages > Duplicate Spread' && step.appQuery === 'InDesign'), 'indesign duplicate spread menu parsed');
    },
  );

  assertSequence(
    'Open InDesign and set data merge source to ~/Desktop/vehicles.csv',
    (sequence) => {
      assert(sequence.some((step) => step.kind === 'menu_click' && step.menuPath?.join(' > ') === 'Window > Utilities > Data Merge' && step.appQuery === 'InDesign'), 'indesign data merge source opens Data Merge');
      assert(sequence.some((step) => step.kind === 'semantic_click' && step.targetLabel === 'Select Data Source...' && step.appQuery === 'InDesign'), 'indesign data merge source selects source');
      assert(sequence.some((step) => step.kind === 'paste_text' && step.text === '~/Desktop/vehicles.csv' && step.appQuery === 'InDesign'), 'indesign data merge source path parsed');
      assert(sequence.some((step) => step.kind === 'semantic_click' && step.targetLabel === 'Preview' && step.appQuery === 'InDesign'), 'indesign data merge source enables preview');
    },
  );

  assertSequence(
    'Open InDesign and create merged document',
    (sequence) => {
      assert(sequence.some((step) => step.kind === 'semantic_click' && step.targetLabel === 'Create Merged Document...' && step.appQuery === 'InDesign'), 'indesign create merged document command parsed');
      assert(sequence.some((step) => step.kind === 'semantic_click' && step.targetLabel === 'OK' && step.appQuery === 'InDesign'), 'indesign create merged document confirms dialog');
    },
  );

  assertSequence(
    'Open InDesign and update all links',
    (sequence) => {
      assert(sequence.some((step) => step.kind === 'menu_click' && step.menuPath?.join(' > ') === 'Window > Links' && step.appQuery === 'InDesign'), 'indesign update links opens Links');
      assert(sequence.some((step) => step.kind === 'semantic_click' && step.targetLabel === 'Update All Links' && step.appQuery === 'InDesign'), 'indesign update all links command parsed');
    },
  );

  assertSequence(
    'Open InDesign and group selected objects',
    (sequence) => {
      assert(sequence.some((step) => step.kind === 'menu_click' && step.menuPath?.join(' > ') === 'Object > Group' && step.appQuery === 'InDesign'), 'indesign group selection menu parsed');
    },
  );

  assertSequence(
    'Open InDesign and lock layer Legal',
    (sequence) => {
      const layerStep = sequence.find((step) => step.kind === 'indesign_set_layer_state');
      assert(layerStep?.targetLabel === 'Legal', 'indesign lock layer target parsed', `saw ${layerStep?.targetLabel}`);
      assert(layerStep?.layerStateAction === 'lock', 'indesign lock layer action parsed', `saw ${layerStep?.layerStateAction}`);
      assert(layerStep?.reason === 'local-indesign-set-layer-state', 'indesign layer state routes to bridge tool', layerStep?.reason);
    },
  );

  assertSequence(
    'Open InDesign and export pages 1-3 as dealer-proof.pdf',
    (sequence) => {
      assert(sequence.some((step) => step.kind === 'menu_click' && step.menuPath?.join(' > ') === 'File > Export...' && step.reason === 'local-indesign-export-page-range'), 'indesign page range export opens Export');
      assert(sequence.some((step) => step.kind === 'paste_text' && step.text === 'dealer-proof.pdf' && step.reason === 'local-save-dialog-filename'), 'indesign page range export filename parsed');
      assert(sequence.some((step) => step.kind === 'set_field_text' && step.targetLabel === 'Range' && step.text === '1-3'), 'indesign page range export range parsed');
    },
  );

  assertSequence(
    'Open InDesign and update dealer banner headline to Memorial Day Sale, price to $29,995, APR to 2.9% for 72 months, disclaimer to See dealer for details',
    (sequence) => {
      const batchStep = sequence.find((step) => step.kind === 'indesign_batch_update_text_layers');
      assert(Boolean(batchStep) && batchStep?.appQuery === 'InDesign', 'indesign multi dealer update uses one batch text-layer operation');
      assert(batchStep?.fieldUpdates?.some((update) => update.fieldName === 'headline' && update.replacementText === 'Memorial Day Sale'), 'indesign multi dealer update targets headline');
      assert(batchStep?.fieldUpdates?.some((update) => update.fieldName === 'price' && update.replacementText === '$29,995'), 'indesign multi dealer price copy parsed');
      assert(batchStep?.fieldUpdates?.some((update) => update.fieldName === 'APR' && update.replacementText === '2.9% for 72 months'), 'indesign multi dealer update targets APR');
      assert(batchStep?.fieldUpdates?.some((update) => update.fieldName === 'disclaimer' && update.replacementText === 'See dealer for details'), 'indesign multi dealer update targets disclaimer');
    },
  );

  assertSequence(
    'Open InDesign and create new 300x250 banner with 0.125 in bleed',
    (sequence) => {
      assert(sequence.some((step) => step.kind === 'press_keys' && step.combo === 'Cmd+N' && step.appQuery === 'InDesign'), 'indesign sized document opens new document');
      assert(sequence.some((step) => step.kind === 'set_field_text' && step.targetLabel === 'Width' && step.text === '300'), 'indesign sized document width parsed');
      assert(sequence.some((step) => step.kind === 'set_field_text' && step.targetLabel === 'Height' && step.text === '250'), 'indesign sized document height parsed');
      assert(sequence.some((step) => step.kind === 'set_field_text' && step.targetLabel === 'Bleed Top' && step.text === '0.125 in'), 'indesign sized document bleed parsed');
      assert(sequence.some((step) => step.kind === 'semantic_click' && step.targetLabel === 'Create' && step.reason === 'local-indesign-create-sized-document'), 'indesign sized document creates document');
    },
  );

  assertSequence(
    'Open InDesign and set margins to 0.25 in',
    (sequence) => {
      assert(sequence.some((step) => step.kind === 'menu_click' && step.menuPath?.join(' > ') === 'Layout > Margins and Columns...' && step.appQuery === 'InDesign'), 'indesign margins opens dialog');
      assert(sequence.some((step) => step.kind === 'set_field_text' && step.targetLabel === 'Top' && step.text === '0.25 in'), 'indesign margins top parsed');
      assert(sequence.some((step) => step.kind === 'set_field_text' && step.targetLabel === 'Outside' && step.text === '0.25 in'), 'indesign margins outside parsed');
    },
  );

  assertSequence(
    'Open InDesign and create layer Legal',
    (sequence) => {
      assert(sequence.some((step) => step.kind === 'semantic_click' && step.targetLabel === 'New Layer...' && step.appQuery === 'InDesign'), 'indesign create layer command parsed');
      assert(sequence.some((step) => step.kind === 'set_field_text' && step.targetLabel === 'Name' && step.text === 'Legal'), 'indesign create layer name parsed');
    },
  );

  assertSequence(
    'Open InDesign and rename layer Legal to Fine Print',
    (sequence) => {
      assert(sequence.some((step) => step.kind === 'semantic_click' && step.targetLabel === 'Legal' && step.appQuery === 'InDesign'), 'indesign rename layer selects source');
      assert(sequence.some((step) => step.kind === 'semantic_click' && step.targetLabel === 'Layer Options...' && step.appQuery === 'InDesign'), 'indesign rename layer opens options');
      assert(sequence.some((step) => step.kind === 'set_field_text' && step.targetLabel === 'Name' && step.text === 'Fine Print'), 'indesign rename layer target parsed');
    },
  );

  assertSequence(
    'Open InDesign and create swatch Toyota Red #eb0a1e',
    (sequence) => {
      assert(sequence.some((step) => step.kind === 'menu_click' && step.menuPath?.join(' > ') === 'Window > Color > Swatches' && step.appQuery === 'InDesign'), 'indesign create swatch opens swatches');
      assert(sequence.some((step) => step.kind === 'set_field_text' && step.targetLabel === 'Swatch Name' && step.text === 'Toyota Red'), 'indesign create swatch name parsed');
      assert(sequence.some((step) => step.kind === 'set_field_text' && step.targetLabel === 'Red' && step.text === '235'), 'indesign create swatch red parsed');
      assert(sequence.some((step) => step.kind === 'set_field_text' && step.targetLabel === 'Green' && step.text === '10'), 'indesign create swatch green parsed');
      assert(sequence.some((step) => step.kind === 'set_field_text' && step.targetLabel === 'Blue' && step.text === '30'), 'indesign create swatch blue parsed');
    },
  );

  assertSequence(
    'Open InDesign and set selected fill color to Toyota Red',
    (sequence) => {
      assert(sequence.some((step) => step.kind === 'semantic_click' && step.targetLabel === 'Fill' && step.appQuery === 'InDesign'), 'indesign apply swatch chooses fill');
      assert(sequence.some((step) => step.kind === 'semantic_click' && step.targetLabel === 'Toyota Red' && step.reason === 'local-indesign-apply-swatch'), 'indesign apply swatch target parsed');
    },
  );

  assertSequence(
    'Open InDesign and wrap text around selected image',
    (sequence) => {
      assert(sequence.some((step) => step.kind === 'menu_click' && step.menuPath?.join(' > ') === 'Window > Text Wrap' && step.appQuery === 'InDesign'), 'indesign text wrap opens panel');
      assert(sequence.some((step) => step.kind === 'semantic_click' && step.targetLabel === 'Wrap Around Bounding Box' && step.appQuery === 'InDesign'), 'indesign text wrap mode parsed');
    },
  );

  assertSequence(
    'Open InDesign and export pdf using preset Dealer Proof as dealer-proof.pdf',
    (sequence) => {
      assert(sequence.some((step) => step.kind === 'menu_click' && step.menuPath?.join(' > ') === 'File > Adobe PDF Presets > Dealer Proof...' && step.appQuery === 'InDesign'), 'indesign named pdf preset parsed');
      assert(sequence.some((step) => step.kind === 'paste_text' && step.text === 'dealer-proof.pdf' && step.reason === 'local-save-dialog-filename'), 'indesign named pdf preset filename parsed');
    },
  );

  assertSequence(
    'Open InDesign and apply parent A-Parent to pages 1-3',
    (sequence) => {
      assert(sequence.some((step) => step.kind === 'semantic_click' && step.targetLabel === 'Apply Parent to Pages...' && step.appQuery === 'InDesign'), 'indesign apply parent command parsed');
      assert(sequence.some((step) => step.kind === 'set_field_text' && step.targetLabel === 'Apply Parent' && step.text === 'A-Parent'), 'indesign apply parent name parsed');
      assert(sequence.some((step) => step.kind === 'set_field_text' && step.targetLabel === 'To Pages' && step.text === '1-3'), 'indesign apply parent range parsed');
    },
  );

  assertSequence(
    'Open InDesign and create guides 3 rows and 4 columns',
    (sequence) => {
      assert(sequence.some((step) => step.kind === 'menu_click' && step.menuPath?.join(' > ') === 'Layout > Create Guides...' && step.appQuery === 'InDesign'), 'indesign create guides opens dialog');
      assert(sequence.some((step) => step.kind === 'set_field_text' && step.targetLabel === 'Rows' && step.text === '3'), 'indesign create guides rows parsed');
      assert(sequence.some((step) => step.kind === 'set_field_text' && step.targetLabel === 'Columns' && step.text === '4'), 'indesign create guides columns parsed');
    },
  );

  assertSequence(
    'Open InDesign and align selected text center',
    (sequence) => {
      assert(sequence.some((step) => step.kind === 'press_keys' && step.combo === 'Cmd+Shift+C' && step.appQuery === 'InDesign'), 'indesign text center shortcut parsed');
    },
  );

  assertSequence(
    'open TextEdit then find invoice number then copy it',
    (sequence) => {
      assert(sequence.length === 4, 'find text sequence expands to shortcut plus query', `saw ${sequence.length}`);
      assert(sequence[0]?.kind === 'launch_app' && sequence[0]?.appQuery === 'TextEdit', 'find sequence launches app');
      assert(sequence[1]?.kind === 'press_keys' && sequence[1]?.combo === 'Cmd+F' && sequence[1]?.appQuery === 'TextEdit', 'find sequence opens find box');
      assert(sequence[2]?.kind === 'type_text' && sequence[2]?.text === 'invoice number' && sequence[2]?.appQuery === 'TextEdit', 'find sequence types query');
      assert(sequence[3]?.kind === 'press_keys' && sequence[3]?.combo === 'Cmd+C' && sequence[3]?.appQuery === 'TextEdit', 'find sequence copies selection');
    },
  );

  assertSequence(
    'open Photoshop then wait for it to load for 8 seconds then click File > New',
    (sequence) => {
      assert(sequence.length === 3, 'wait-for-it sequence length', `saw ${sequence.length}`);
      assert(sequence[0]?.kind === 'launch_app' && sequence[0]?.appQuery === 'Photoshop', 'wait-for-it sequence launches app');
      assert(sequence[1]?.kind === 'wait_for_app' && sequence[1]?.appQuery === 'Photoshop' && sequence[1]?.durationMs === 8000, 'wait-for-it inherits app and duration', `saw ${sequence[1]?.appQuery}/${sequence[1]?.durationMs}`);
      assert(sequence[2]?.kind === 'menu_click' && sequence[2]?.appQuery === 'Photoshop', 'wait-for-it next menu inherits app');
    },
  );

  assertSequence(
    'open Chrome then focus the address bar then type example.com then press Return then zoom in then go to next tab',
    (sequence) => {
      assert(sequence.length === 6, 'browser navigation shortcut sequence length', `saw ${sequence.length}`);
      assert(sequence[0]?.kind === 'launch_app' && sequence[0]?.appQuery === 'Chrome', 'browser shortcut sequence launches app');
      assert(sequence[1]?.kind === 'press_keys' && sequence[1]?.combo === 'Cmd+L' && sequence[1]?.appQuery === 'Chrome', 'browser shortcut sequence address bar inherits app');
      assert(sequence[2]?.kind === 'type_text' && sequence[2]?.text === 'example.com' && sequence[2]?.appQuery === 'Chrome', 'browser shortcut sequence types URL');
      assert(sequence[3]?.kind === 'press_keys' && sequence[3]?.combo === 'Return' && sequence[3]?.appQuery === 'Chrome', 'browser shortcut sequence return inherits app');
      assert(sequence[4]?.kind === 'press_keys' && sequence[4]?.combo === 'Cmd+=' && sequence[4]?.appQuery === 'Chrome', 'browser shortcut sequence zoom inherits app');
      assert(sequence[5]?.kind === 'press_keys' && sequence[5]?.combo === 'Ctrl+Tab' && sequence[5]?.appQuery === 'Chrome', 'browser shortcut sequence next tab inherits app');
    },
  );

  assertSequence(
    'open Photoshop then wait until it is ready then click File > New',
    (sequence) => {
      assert(sequence.length === 3, 'wait-until-ready sequence length', `saw ${sequence.length}`);
      assert(sequence[0]?.kind === 'launch_app' && sequence[0]?.appQuery === 'Photoshop', 'wait-ready sequence launches app');
      assert(sequence[1]?.kind === 'wait_for_app' && sequence[1]?.appQuery === 'Photoshop' && sequence[1]?.durationMs === 8000, 'wait-ready inherits app', `saw ${sequence[1]?.appQuery}/${sequence[1]?.durationMs}`);
      assert(sequence[2]?.kind === 'menu_click' && sequence[2]?.appQuery === 'Photoshop', 'wait-ready menu inherits app');
    },
  );

  assertSequence(
    'open Chrome then navigate to example.com then search web for underground circle',
    (sequence) => {
      assert(sequence.length === 7, 'browser URL/search expansion length', `saw ${sequence.length}`);
      assert(sequence[0]?.kind === 'launch_app' && sequence[0]?.appQuery === 'Chrome', 'browser expansion launches Chrome');
      assert(sequence[1]?.kind === 'press_keys' && sequence[1]?.combo === 'Cmd+L' && sequence[1]?.appQuery === 'Chrome', 'browser URL focuses address bar');
      assert(sequence[2]?.kind === 'type_text' && sequence[2]?.text === 'https://example.com' && sequence[2]?.appQuery === 'Chrome', 'browser URL typed');
      assert(sequence[3]?.kind === 'press_keys' && sequence[3]?.combo === 'Return' && sequence[3]?.appQuery === 'Chrome', 'browser URL submitted');
      assert(sequence[4]?.kind === 'press_keys' && sequence[4]?.combo === 'Cmd+L' && sequence[4]?.appQuery === 'Chrome', 'browser search focuses address bar');
      assert(sequence[5]?.kind === 'type_text' && sequence[5]?.text === 'underground circle' && sequence[5]?.appQuery === 'Chrome', 'browser search query typed');
      assert(sequence[6]?.kind === 'press_keys' && sequence[6]?.combo === 'Return' && sequence[6]?.appQuery === 'Chrome', 'browser search submitted');
    },
  );

  assertSequence(
    'open example.com in a new tab in Chrome',
    (sequence) => {
      assert(sequence.length === 4, 'standalone new-tab URL macro length', `saw ${sequence.length}`);
      assert(sequence[0]?.kind === 'focus_app' && sequence[0]?.appQuery === 'Chrome', 'new-tab macro focuses browser');
      assert(sequence[1]?.kind === 'press_keys' && sequence[1]?.combo === 'Cmd+T' && sequence[1]?.appQuery === 'Chrome', 'new-tab macro opens tab');
      assert(sequence[2]?.kind === 'type_text' && sequence[2]?.text === 'https://example.com' && sequence[2]?.appQuery === 'Chrome', 'new-tab macro types URL');
      assert(sequence[3]?.kind === 'press_keys' && sequence[3]?.combo === 'Return' && sequence[3]?.appQuery === 'Chrome', 'new-tab macro submits URL');
    },
  );

  assertSequence(
    'search web for deterministic agents in Chrome',
    (sequence) => {
      assert(sequence.length === 4, 'standalone browser search macro length', `saw ${sequence.length}`);
      assert(sequence[0]?.kind === 'focus_app' && sequence[0]?.appQuery === 'Chrome', 'browser search macro focuses browser');
      assert(sequence[1]?.kind === 'press_keys' && sequence[1]?.combo === 'Cmd+L' && sequence[1]?.appQuery === 'Chrome', 'browser search macro focuses address bar');
      assert(sequence[2]?.kind === 'type_text' && sequence[2]?.text === 'deterministic agents' && sequence[2]?.appQuery === 'Chrome', 'browser search macro types query');
      assert(sequence[3]?.kind === 'press_keys' && sequence[3]?.combo === 'Return' && sequence[3]?.appQuery === 'Chrome', 'browser search macro submits query');
    },
  );

  assertSequence(
    'copy current URL in Chrome',
    (sequence) => {
      assert(sequence.length === 3, 'copy current URL macro length', `saw ${sequence.length}`);
      assert(sequence[0]?.kind === 'focus_app' && sequence[0]?.appQuery === 'Chrome', 'copy URL macro focuses browser');
      assert(sequence[1]?.kind === 'press_keys' && sequence[1]?.combo === 'Cmd+L' && sequence[1]?.appQuery === 'Chrome', 'copy URL macro selects address');
      assert(sequence[2]?.kind === 'press_keys' && sequence[2]?.combo === 'Cmd+C' && sequence[2]?.appQuery === 'Chrome', 'copy URL macro copies address');
    },
  );

  assertSequence(
    'find pricing on this page in Chrome',
    (sequence) => {
      assert(sequence.length === 3, 'find-on-page macro length', `saw ${sequence.length}`);
      assert(sequence[0]?.kind === 'focus_app' && sequence[0]?.appQuery === 'Chrome', 'find-page macro focuses browser');
      assert(sequence[1]?.kind === 'press_keys' && sequence[1]?.combo === 'Cmd+F' && sequence[1]?.appQuery === 'Chrome', 'find-page macro opens find');
      assert(sequence[2]?.kind === 'type_text' && sequence[2]?.text === 'pricing' && sequence[2]?.appQuery === 'Chrome', 'find-page macro types search');
    },
  );

  assertSequence(
    'open Chrome then copy current URL then find docs on this page',
    (sequence) => {
      assert(sequence.length === 5, 'contextual browser macros inherit launched app', `saw ${sequence.length}`);
      assert(sequence[0]?.kind === 'launch_app' && sequence[0]?.appQuery === 'Chrome', 'context macro launches Chrome');
      assert(sequence[1]?.kind === 'press_keys' && sequence[1]?.combo === 'Cmd+L' && sequence[1]?.appQuery === 'Chrome', 'context macro selects URL');
      assert(sequence[2]?.kind === 'press_keys' && sequence[2]?.combo === 'Cmd+C' && sequence[2]?.appQuery === 'Chrome', 'context macro copies URL');
      assert(sequence[3]?.kind === 'press_keys' && sequence[3]?.combo === 'Cmd+F' && sequence[3]?.appQuery === 'Chrome', 'context macro opens find');
      assert(sequence[4]?.kind === 'type_text' && sequence[4]?.text === 'docs' && sequence[4]?.appQuery === 'Chrome', 'context macro finds docs');
    },
  );

  assertSequence(
    'open TextEdit then replace all text with hello world then save',
    (sequence) => {
      assert(sequence.length === 4, 'replace-all macro sequence length', `saw ${sequence.length}`);
      assert(sequence[0]?.kind === 'launch_app' && sequence[0]?.appQuery === 'TextEdit', 'replace macro launches app');
      assert(sequence[1]?.kind === 'press_keys' && sequence[1]?.combo === 'Cmd+A' && sequence[1]?.appQuery === 'TextEdit', 'replace macro selects all');
      assert(sequence[2]?.kind === 'paste_text' && sequence[2]?.text === 'hello world' && sequence[2]?.appQuery === 'TextEdit', 'replace macro pastes new text');
      assert(sequence[3]?.kind === 'press_keys' && sequence[3]?.combo === 'Cmd+S' && sequence[3]?.appQuery === 'TextEdit', 'replace macro saves');
    },
  );

  assertSequence(
    'open TextEdit then clear document then type reset',
    (sequence) => {
      assert(sequence.length === 4, 'clear-document macro sequence length', `saw ${sequence.length}`);
      assert(sequence[0]?.kind === 'launch_app' && sequence[0]?.appQuery === 'TextEdit', 'clear macro launches app');
      assert(sequence[1]?.kind === 'press_keys' && sequence[1]?.combo === 'Cmd+A' && sequence[1]?.appQuery === 'TextEdit', 'clear macro selects all');
      assert(sequence[2]?.kind === 'press_keys' && sequence[2]?.combo === 'Delete' && sequence[2]?.appQuery === 'TextEdit', 'clear macro deletes');
      assert(sequence[3]?.kind === 'type_text' && sequence[3]?.text === 'reset' && sequence[3]?.appQuery === 'TextEdit', 'clear macro types reset');
    },
  );

  assertSequence(
    'open Chrome then switch to third tab then go back then go forward then hard refresh',
    (sequence) => {
      assert(sequence.length === 5, 'browser shortcut sequence length', `saw ${sequence.length}`);
      assert(sequence[0]?.kind === 'launch_app' && sequence[0]?.appQuery === 'Chrome', 'browser shortcut sequence launches app');
      assert(sequence[1]?.kind === 'press_keys' && sequence[1]?.combo === 'Cmd+3' && sequence[1]?.appQuery === 'Chrome', 'browser shortcut numbered tab inherits app');
      assert(sequence[2]?.kind === 'press_keys' && sequence[2]?.combo === 'Cmd+[' && sequence[2]?.appQuery === 'Chrome', 'browser shortcut back inherits app');
      assert(sequence[3]?.kind === 'press_keys' && sequence[3]?.combo === 'Cmd+]' && sequence[3]?.appQuery === 'Chrome', 'browser shortcut forward inherits app');
      assert(sequence[4]?.kind === 'press_keys' && sequence[4]?.combo === 'Cmd+Shift+R' && sequence[4]?.appQuery === 'Chrome', 'browser shortcut hard refresh inherits app');
    },
  );

  assertSequence(
    'Search Spotlight for Photoshop',
    (sequence) => {
      assert(sequence.length === 4, 'mac spotlight search macro length', `saw ${sequence.length}`);
      assert(sequence[0]?.kind === 'press_keys' && sequence[0]?.combo === 'Cmd+Space', 'mac spotlight opens');
      assert(sequence[2]?.kind === 'paste_text' && sequence[2]?.text === 'Photoshop', 'mac spotlight query parsed', `saw ${sequence[2]?.text}`);
      assert(sequence[3]?.kind === 'press_keys' && sequence[3]?.combo === 'Return', 'mac spotlight submits query');
    },
  );

  assertSequence(
    'Show Mission Control',
    (sequence) => {
      assert(sequence.length === 2, 'mac mission control macro length', `saw ${sequence.length}`);
      assert(sequence[0]?.kind === 'press_keys' && sequence[0]?.combo === 'Ctrl+Up', 'mac mission control shortcut parsed');
    },
  );

  assertSequence(
    'Open Finder Downloads',
    (sequence) => {
      assert(sequence.length === 3, 'mac finder downloads macro length', `saw ${sequence.length}`);
      assert(sequence[0]?.kind === 'launch_app' && sequence[0]?.appQuery === 'Finder', 'mac finder macro launches Finder');
      assert(sequence[2]?.kind === 'press_keys' && sequence[2]?.combo === 'Cmd+Opt+L' && sequence[2]?.appQuery === 'Finder', 'mac finder downloads shortcut parsed');
    },
  );

  assertSequence(
    'Open Finder then set list view',
    (sequence) => {
      assert(sequence.length === 2, 'mac finder contextual view macro length', `saw ${sequence.length}`);
      assert(sequence[0]?.kind === 'launch_app' && sequence[0]?.appQuery === 'Finder', 'mac finder contextual view launches Finder');
      assert(sequence[1]?.kind === 'press_keys' && sequence[1]?.combo === 'Cmd+2' && sequence[1]?.appQuery === 'Finder', 'mac finder contextual list view parsed');
    },
  );

  assertSequence(
    'Open System Settings Accessibility',
    (sequence) => {
      assert(sequence.length === 7, 'mac system settings pane macro length', `saw ${sequence.length}`);
      assert(sequence[0]?.kind === 'launch_app' && sequence[0]?.appQuery === 'System Settings', 'mac settings launches System Settings');
      assert(sequence[2]?.kind === 'press_keys' && sequence[2]?.combo === 'Cmd+F' && sequence[2]?.appQuery === 'System Settings', 'mac settings focuses search');
      assert(sequence[4]?.kind === 'paste_text' && sequence[4]?.text === 'Accessibility' && sequence[4]?.appQuery === 'System Settings', 'mac settings query parsed', `saw ${sequence[4]?.text}`);
    },
  );

  assertSequence(
    'Take selection screenshot',
    (sequence) => {
      assert(sequence.length === 2, 'mac screenshot selection macro length', `saw ${sequence.length}`);
      assert(sequence[0]?.kind === 'press_keys' && sequence[0]?.combo === 'Cmd+Shift+4', 'mac screenshot selection shortcut parsed');
    },
  );

  assertSequence(
    'Open Photoshop and save for web as export.jpg',
    (sequence) => {
      assert(sequence.length === 7, 'photoshop save-for-web UI sequence length', `saw ${sequence.length}`);
      assert(sequence[1]?.kind === 'press_keys' && sequence[1]?.combo === 'Cmd+Opt+Shift+S' && sequence[1]?.appQuery === 'Photoshop', 'photoshop explicit save-for-web opens Save for Web');
      assert(sequence[3]?.kind === 'semantic_click' && sequence[3]?.reason === 'local-save-for-web-save-button' && sequence[3]?.appQuery === 'Photoshop', 'photoshop explicit save-for-web clicks verified Save button');
      assert(sequence[5]?.kind === 'paste_text' && sequence[5]?.text === 'export.jpg' && sequence[5]?.reason === 'local-save-dialog-output-path', 'photoshop explicit save-for-web sets output path');
    },
  );

  assertSequence(
    'Open Photoshop and set image resolution to 300 dpi',
    (sequence) => {
      assert(sequence.length === 5, 'photoshop resolution sequence length', `saw ${sequence.length}`);
      assert(sequence[1]?.kind === 'menu_click' && sequence[1]?.menuPath?.join(' > ') === 'Image > Image Size...' && sequence[1]?.appQuery === 'Photoshop', 'photoshop resolution opens Image Size');
      assert(sequence[3]?.kind === 'set_field_text' && sequence[3]?.targetLabel === 'Resolution' && sequence[3]?.text === '300', 'photoshop resolution sets field');
    },
  );

  assertSequence(
    'Open Photoshop and select sky',
    (sequence) => {
      assert(sequence.length === 3, 'photoshop select sky sequence length', `saw ${sequence.length}`);
      assert(sequence[1]?.kind === 'menu_click' && sequence[1]?.menuPath?.join(' > ') === 'Select > Sky' && sequence[1]?.appQuery === 'Photoshop', 'photoshop select sky menu parsed');
    },
  );

  assertSequence(
    'Open Photoshop and export layers to files',
    (sequence) => {
      assert(sequence.some((step) => step.kind === 'menu_click' && step.menuPath?.join(' > ') === 'File > Export > Layers to Files...' && step.appQuery === 'Photoshop'), 'photoshop export layers to files parsed');
    },
  );

  assertSequence(
    'Open Photoshop and replace background with neon city skyline',
    (sequence) => {
      assert(sequence.some((step) => step.kind === 'menu_click' && step.menuPath?.join(' > ') === 'Select > Subject' && step.appQuery === 'Photoshop'), 'photoshop replace background selects subject');
      assert(sequence.some((step) => step.kind === 'menu_click' && step.menuPath?.join(' > ') === 'Select > Inverse' && step.appQuery === 'Photoshop'), 'photoshop replace background inverts selection');
      assert(sequence.some((step) => step.kind === 'menu_click' && step.menuPath?.join(' > ') === 'Edit > Generative Fill...' && step.appQuery === 'Photoshop'), 'photoshop replace background opens Generative Fill');
      assert(sequence.some((step) => step.kind === 'paste_text' && step.text === 'neon city skyline' && step.reason === 'local-photoshop-ai-prompt'), 'photoshop replace background prompt parsed');
      assert(sequence.some((step) => step.kind === 'semantic_click' && step.targetLabel === 'Generate' && step.reason === 'local-photoshop-ai-generate'), 'photoshop replace background generates');
    },
  );

  assertSequence(
    'Open Photoshop and AI edit the image to add cinematic rain',
    (sequence) => {
      assert(sequence.some((step) => step.kind === 'menu_click' && step.menuPath?.join(' > ') === 'Edit > Generative Fill...' && step.appQuery === 'Photoshop'), 'photoshop ai edit opens Generative Fill');
      assert(sequence.some((step) => step.kind === 'paste_text' && step.text === 'cinematic rain' && step.reason === 'local-photoshop-ai-prompt'), 'photoshop ai edit prompt parsed');
      assert(sequence.some((step) => step.kind === 'semantic_click' && step.targetLabel === 'Generate'), 'photoshop ai edit generates');
    },
  );

  assertSequence(
    'Open Photoshop and fill selected area with neon glass flowers',
    (sequence) => {
      assert(sequence.some((step) => step.kind === 'menu_click' && step.menuPath?.join(' > ') === 'Edit > Generative Fill...' && step.appQuery === 'Photoshop'), 'photoshop selected area fill opens Generative Fill');
      assert(sequence.some((step) => step.kind === 'paste_text' && step.text === 'neon glass flowers' && step.reason === 'local-photoshop-ai-prompt'), 'photoshop selected area fill prompt parsed');
      assert(sequence.some((step) => step.kind === 'semantic_click' && step.targetLabel === 'Generate' && step.reason === 'local-photoshop-ai-generate'), 'photoshop selected area fill generates');
    },
  );

  assertSequence(
    'Open Photoshop and put a waterfall where I highlighted',
    (sequence) => {
      assert(sequence.some((step) => step.kind === 'menu_click' && step.menuPath?.join(' > ') === 'Edit > Generative Fill...' && step.appQuery === 'Photoshop'), 'photoshop loose highlight fill opens Generative Fill');
      assert(sequence.some((step) => step.kind === 'paste_text' && step.text === 'a waterfall' && step.reason === 'local-photoshop-ai-prompt'), 'photoshop loose highlight fill prompt parsed');
    },
  );

  assertSequence(
    'Open Photoshop and make the part I selected neon chrome',
    (sequence) => {
      assert(sequence.some((step) => step.kind === 'menu_click' && step.menuPath?.join(' > ') === 'Edit > Generative Fill...' && step.appQuery === 'Photoshop'), 'photoshop selected part fill opens Generative Fill');
      assert(sequence.some((step) => step.kind === 'paste_text' && step.text === 'neon chrome' && step.reason === 'local-photoshop-ai-prompt'), 'photoshop selected part fill prompt parsed');
    },
  );

  assertSequence(
    'Open Photoshop and clean up what I circled',
    (sequence) => {
      assert(sequence.some((step) => step.kind === 'menu_click' && step.menuPath?.join(' > ') === 'Edit > Generative Fill...' && step.appQuery === 'Photoshop'), 'photoshop circled cleanup opens Generative Fill');
      assert(!sequence.some((step) => step.kind === 'paste_text' && step.reason === 'local-photoshop-ai-prompt'), 'photoshop circled cleanup uses blank prompt');
      assert(sequence.some((step) => step.kind === 'semantic_click' && step.targetLabel === 'Generate' && step.reason === 'local-photoshop-ai-generate'), 'photoshop circled cleanup generates');
    },
  );

  assertSequence(
    'Open Photoshop and remove highlighted section with generative fill',
    (sequence) => {
      assert(sequence.some((step) => step.kind === 'menu_click' && step.menuPath?.join(' > ') === 'Edit > Generative Fill...' && step.appQuery === 'Photoshop'), 'photoshop selected removal opens Generative Fill');
      assert(!sequence.some((step) => step.kind === 'paste_text' && step.reason === 'local-photoshop-ai-prompt'), 'photoshop selected removal uses blank Generative Fill prompt');
      assert(sequence.some((step) => step.kind === 'semantic_click' && step.targetLabel === 'Generate' && step.reason === 'local-photoshop-ai-generate'), 'photoshop selected removal generates');
    },
  );

  assertSequence(
    'Open Photoshop and select area from 100,200 to 500,650 then generative fill with sunset water',
    (sequence) => {
      assert(sequence.some((step) => step.kind === 'press_keys' && step.combo === 'M' && step.appQuery === 'Photoshop'), 'photoshop rectangular fill selects marquee tool');
      assert(sequence.some((step) => step.kind === 'mouse_drag' && step.fromX === 100 && step.fromY === 200 && step.toX === 500 && step.toY === 650), 'photoshop rectangular fill drags selection coordinates');
      assert(sequence.some((step) => step.kind === 'menu_click' && step.menuPath?.join(' > ') === 'Edit > Generative Fill...' && step.appQuery === 'Photoshop'), 'photoshop rectangular fill opens Generative Fill');
      assert(sequence.some((step) => step.kind === 'paste_text' && step.text === 'sunset water' && step.reason === 'local-photoshop-ai-prompt'), 'photoshop rectangular fill prompt parsed');
    },
  );

  assertSequence(
    'Open Photoshop and use selection brush tool for generative fill',
    (sequence) => {
      assert(sequence.some((step) => step.kind === 'semantic_click' && step.targetLabel === 'Selection Brush Tool' && step.appQuery === 'Photoshop'), 'photoshop selection brush tool parsed');
      assert(sequence.some((step) => step.kind === 'menu_click' && step.menuPath?.join(' > ') === 'Window > Contextual Task Bar' && step.appQuery === 'Photoshop'), 'photoshop selection brush opens contextual task bar');
    },
  );

  assertSequence(
    'Open Photoshop and use selection brush from 120,220 to 520,620 then generative fill with mossy stone texture',
    (sequence) => {
      assert(sequence.some((step) => step.kind === 'semantic_click' && step.targetLabel === 'Selection Brush Tool' && step.appQuery === 'Photoshop'), 'photoshop brush fill selects brush tool');
      assert(sequence.some((step) => step.kind === 'mouse_drag' && step.fromX === 120 && step.fromY === 220 && step.toX === 520 && step.toY === 620 && step.reason === 'local-photoshop-selection-brush-drag'), 'photoshop brush fill drags stroke coordinates');
      assert(sequence.some((step) => step.kind === 'menu_click' && step.menuPath?.join(' > ') === 'Edit > Generative Fill...' && step.appQuery === 'Photoshop'), 'photoshop brush fill opens Generative Fill');
      assert(sequence.some((step) => step.kind === 'paste_text' && step.text === 'mossy stone texture' && step.reason === 'local-photoshop-ai-prompt'), 'photoshop brush fill prompt parsed');
    },
  );

  const missingPhotoshopFillDetails = buildPhotoshopGenerativeFillClarification('Open Photoshop and use generative fill');
  assert(missingPhotoshopFillDetails.route, 'photoshop ambiguous Generative Fill asks for details');
  assert(missingPhotoshopFillDetails.missing.includes('target_area'), 'photoshop ambiguous fill asks for target area');
  assert(missingPhotoshopFillDetails.missing.includes('fill_prompt'), 'photoshop ambiguous fill asks for fill prompt');

  const missingPhotoshopFillPrompt = buildPhotoshopGenerativeFillClarification('Open Photoshop and fill selected area');
  assert(missingPhotoshopFillPrompt.route, 'photoshop selected area without prompt asks follow-up');
  assert(!missingPhotoshopFillPrompt.missing.includes('target_area'), 'photoshop selected area follow-up does not ask area again');
  assert(missingPhotoshopFillPrompt.missing.includes('fill_prompt'), 'photoshop selected area follow-up asks prompt');

  const missingPhotoshopArea = buildPhotoshopGenerativeFillClarification('Open Photoshop and add a dragon with generative fill');
  assert(missingPhotoshopArea.route, 'photoshop add prompt without area asks follow-up');
  assert(missingPhotoshopArea.missing.includes('target_area'), 'photoshop add prompt asks for target area');
  assert(!missingPhotoshopArea.missing.includes('fill_prompt'), 'photoshop add prompt does not ask prompt again');

  const screenshotWorkflowClarification = buildPhotoshopGenerativeFillClarification(PHOTOSHOP_SCREENSHOT_RENAME_REQUEST);
  assert(!screenshotWorkflowClarification.route, 'photoshop screenshot open/rename/export does not ask Generative Fill follow-up', screenshotWorkflowClarification.reason);

  const missingInDesignBannerDetails = buildInDesignBannerClarification('Open InDesign and change the banners');
  assert(missingInDesignBannerDetails.route, 'indesign broad banner request asks for details');
  assert(missingInDesignBannerDetails.missing.includes('change_details'), 'indesign broad banner request asks for change details');

  const missingInDesignBannerTarget = buildInDesignBannerClarification('Open InDesign and replace with ~/Desktop/replacement.png for the banner');
  assert(missingInDesignBannerTarget.route, 'indesign banner asset without specific target asks follow-up');
  assert(missingInDesignBannerTarget.missing.includes('banner_target'), 'indesign banner asset follow-up asks for target');

  const readyInDesignBannerRequest = buildInDesignBannerClarification('Open InDesign and set selected banner headline to Spring Sale');
  assert(!readyInDesignBannerRequest.route, 'indesign concrete banner request skips clarification');

  assertSequence(
    'Open Photoshop and create Instagram story canvas with futuristic swan ad',
    (sequence) => {
      assert(sequence.some((step) => step.kind === 'set_field_text' && step.targetLabel === 'Width' && step.text === '1080' && step.appQuery === 'Photoshop'), 'photoshop social story width parsed');
      assert(sequence.some((step) => step.kind === 'set_field_text' && step.targetLabel === 'Height' && step.text === '1920' && step.appQuery === 'Photoshop'), 'photoshop social story height parsed');
      assert(sequence.some((step) => step.kind === 'semantic_click' && step.targetLabel === 'Generate Image' && step.appQuery === 'Photoshop'), 'photoshop social canvas opens Generate Image');
      assert(sequence.some((step) => step.kind === 'paste_text' && step.text === 'futuristic swan ad' && step.reason === 'local-photoshop-ai-prompt'), 'photoshop social canvas prompt parsed');
    },
  );

  assertSequence(
    'Open Photoshop and harmonize selected object with background',
    (sequence) => {
      assert(sequence.some((step) => step.kind === 'menu_click' && step.menuPath?.join(' > ') === 'Window > Contextual Task Bar' && step.appQuery === 'Photoshop'), 'photoshop harmonize opens contextual task bar');
      assert(sequence.some((step) => step.kind === 'semantic_click' && step.targetLabel === 'Harmonize' && step.reason === 'local-photoshop-ai-harmonize'), 'photoshop harmonize command parsed');
      assert(sequence.some((step) => step.kind === 'semantic_click' && step.targetLabel === 'Generate' && step.reason === 'local-photoshop-ai-generate'), 'photoshop harmonize generates');
    },
  );

  assertSequence(
    'Open InDesign and generate image of modular future city',
    (sequence) => {
      assert(sequence.some((step) => step.kind === 'menu_click' && step.menuPath?.join(' > ') === 'File > Generate' && step.appQuery === 'InDesign'), 'indesign text-to-image opens Generate panel');
      assert(sequence.some((step) => step.kind === 'semantic_click' && step.targetLabel === 'Text to Image' && step.appQuery === 'InDesign'), 'indesign text-to-image control parsed');
      assert(sequence.some((step) => step.kind === 'paste_text' && step.text === 'modular future city' && step.reason === 'local-indesign-ai-prompt'), 'indesign text-to-image prompt parsed');
    },
  );

  assertSequence(
    'Open InDesign and generative expand selected image with wider skyline',
    (sequence) => {
      assert(sequence.some((step) => step.kind === 'menu_click' && step.menuPath?.join(' > ') === 'Window > Contextual Task Bar' && step.appQuery === 'InDesign'), 'indesign generative expand opens contextual task bar');
      assert(sequence.some((step) => step.kind === 'semantic_click' && step.targetLabel === 'Generative Expand' && step.appQuery === 'InDesign'), 'indesign generative expand command parsed');
      assert(sequence.some((step) => step.kind === 'paste_text' && step.text === 'wider skyline' && step.reason === 'local-indesign-ai-prompt'), 'indesign generative expand prompt parsed');
    },
  );

  assertSequence(
    'Open InDesign and generate alt text',
    (sequence) => {
      assert(sequence.some((step) => step.kind === 'menu_click' && step.menuPath?.join(' > ') === 'Object > Object Export Options...' && step.appQuery === 'InDesign'), 'indesign alt text opens object export options');
      assert(sequence.some((step) => step.kind === 'semantic_click' && step.targetLabel === 'Generate Alt Text' && step.appQuery === 'InDesign'), 'indesign alt text generate command parsed');
    },
  );

  assertSequence(
    'Open InDesign and create tri-fold brochure layout',
    (sequence) => {
      assert(sequence.some((step) => step.kind === 'press_keys' && step.combo === 'Cmd+N' && step.appQuery === 'InDesign'), 'indesign brochure opens new document');
      assert(sequence.some((step) => step.kind === 'set_field_text' && step.targetLabel === 'Columns' && step.text === '3' && step.appQuery === 'InDesign'), 'indesign brochure sets three columns');
      assert(sequence.some((step) => step.kind === 'menu_click' && step.menuPath?.join(' > ') === 'Window > Styles > Paragraph Styles' && step.appQuery === 'InDesign'), 'indesign brochure opens paragraph styles');
      assert(sequence.some((step) => step.kind === 'menu_click' && step.menuPath?.join(' > ') === 'Window > Links' && step.appQuery === 'InDesign'), 'indesign brochure opens links panel');
    },
  );

  assertSequence(
    'Open InDesign and show hidden characters',
    (sequence) => {
      assert(sequence.some((step) => step.kind === 'menu_click' && step.menuPath?.join(' > ') === 'Type > Show Hidden Characters' && step.appQuery === 'InDesign'), 'indesign hidden characters menu parsed');
    },
  );

  assertSequence(
    'Open InDesign and insert current page number',
    (sequence) => {
      assert(sequence.some((step) => step.kind === 'menu_click' && step.menuPath?.join(' > ') === 'Type > Insert Special Character > Markers > Current Page Number' && step.appQuery === 'InDesign'), 'indesign current page number menu parsed');
    },
  );

  assertSequence(
    'Open InDesign and show data merge panel',
    (sequence) => {
      assert(sequence.some((step) => step.kind === 'menu_click' && step.menuPath?.join(' > ') === 'Window > Utilities > Data Merge' && step.appQuery === 'InDesign'), 'indesign data merge panel parsed');
    },
  );

  assertSequence(
    'Open InDesign and show separations preview',
    (sequence) => {
      assert(sequence.some((step) => step.kind === 'menu_click' && step.menuPath?.join(' > ') === 'Window > Output > Separations Preview' && step.appQuery === 'InDesign'), 'indesign separations preview parsed');
    },
  );

  assertSequence(
    'Open Gmail inbox',
    (sequence) => {
      assert(sequence.length === 2, 'gmail inbox macro length', `saw ${sequence.length}`);
      assert(sequence[0]?.kind === 'open_url' && sequence[0]?.url === 'https://mail.google.com/mail/u/0/#inbox', 'gmail inbox opens direct inbox URL', `saw ${sequence[0]?.url}`);
    },
  );

  assertSequence(
    'Search Gmail for invoice 123',
    (sequence) => {
      assert(sequence.length === 2, 'gmail search macro length', `saw ${sequence.length}`);
      assert(sequence[0]?.kind === 'open_url' && sequence[0]?.url === 'https://mail.google.com/mail/u/0/#search/invoice%20123', 'gmail search opens encoded Gmail search URL', `saw ${sequence[0]?.url}`);
    },
  );

  assertSequence(
    'Draft Gmail to chris@example.com subject Test body Hello',
    (sequence) => {
      assert(sequence.length === 2, 'gmail draft macro length', `saw ${sequence.length}`);
      assert(sequence[0]?.kind === 'open_url' && /view=cm/.test(sequence[0]?.url || ''), 'gmail draft opens compose URL', `saw ${sequence[0]?.url}`);
      assert(/to=chris%40example\.com/.test(sequence[0]?.url || ''), 'gmail draft recipient encoded', `saw ${sequence[0]?.url}`);
      assert(/su=Test/.test(sequence[0]?.url || ''), 'gmail draft subject encoded', `saw ${sequence[0]?.url}`);
      assert(/body=Hello/.test(sequence[0]?.url || ''), 'gmail draft body encoded', `saw ${sequence[0]?.url}`);
    },
  );

  assertSequence(
    'Send Gmail to chris@example.com subject Test body Hello',
    (sequence) => {
      assert(sequence.some((step) => step.kind === 'semantic_click' && step.targetLabel === 'Send' && step.reason === 'local-gmail-send'), 'gmail send macro includes approval-sensitive Send click');
    },
  );

  assertSequence(
    'Open WordPress posts for example.com',
    (sequence) => {
      assert(sequence.length === 2, 'wordpress posts macro length', `saw ${sequence.length}`);
      assert(sequence[0]?.kind === 'open_url' && sequence[0]?.url === 'https://example.com/wp-admin/edit.php', 'wordpress posts opens self-hosted posts admin URL', `saw ${sequence[0]?.url}`);
    },
  );

  assertSequence(
    'Open WordPress new post for https://example.com',
    (sequence) => {
      assert(sequence.length === 2, 'wordpress new post macro length', `saw ${sequence.length}`);
      assert(sequence[0]?.kind === 'open_url' && sequence[0]?.url === 'https://example.com/wp-admin/post-new.php', 'wordpress new post opens self-hosted editor URL', `saw ${sequence[0]?.url}`);
    },
  );

  assertSequence(
    'Open WordPress media library',
    (sequence) => {
      assert(sequence.length === 2, 'wordpress media macro length', `saw ${sequence.length}`);
      assert(sequence[0]?.kind === 'open_url' && sequence[0]?.url === 'https://wordpress.com/media', 'wordpress media opens wordpress.com fallback URL', `saw ${sequence[0]?.url}`);
    },
  );

  assertSequence(
    'open wp-admin plugins for example.com',
    (sequence) => {
      assert(sequence.length === 2, 'wp-admin plugins macro length', `saw ${sequence.length}`);
      assert(sequence[0]?.kind === 'open_url' && sequence[0]?.url === 'https://example.com/wp-admin/plugins.php', 'wp-admin plugins opens self-hosted plugins URL', `saw ${sequence[0]?.url}`);
    },
  );

  assertSequence(
    'open wp-admin settings for example.com',
    (sequence) => {
      assert(sequence.length === 2, 'wp-admin settings macro length', `saw ${sequence.length}`);
      assert(sequence[0]?.kind === 'open_url' && sequence[0]?.url === 'https://example.com/wp-admin/options-general.php', 'wp-admin settings opens self-hosted settings URL', `saw ${sequence[0]?.url}`);
    },
  );

  assertSequence(
    'open Dealer Inspire slides for example.com',
    (sequence) => {
      assert(sequence.length === 2, 'Dealer Inspire slides macro length', `saw ${sequence.length}`);
      assert(sequence[0]?.kind === 'open_url' && sequence[0]?.url === 'https://example.com/wp/wp-admin/edit.php?post_type=di_slide', 'Dealer Inspire slides opens DI Slides list URL', `saw ${sequence[0]?.url}`);
    },
  );

  assertSequence(
    'open new Dealer Inspire slide for example.com',
    (sequence) => {
      assert(sequence.length === 2, 'new Dealer Inspire slide macro length', `saw ${sequence.length}`);
      assert(sequence[0]?.kind === 'open_url' && sequence[0]?.url === 'https://example.com/wp/wp-admin/post-new.php?post_type=di_slide', 'new Dealer Inspire slide opens DI Slide editor URL', `saw ${sequence[0]?.url}`);
    },
  );

  const browserPlan = buildChatAutomationPlan({
    message: 'Extract product names and prices from https://example.com/catalog as JSON',
  });
  assert(
    browserPlan.execution.kind === 'run_computer_task',
    'browser data extraction still routes to Computer Use',
    `saw ${browserPlan.execution.kind}`,
  );

  if (failures > 0) {
    console.error(`\n${failures} local desktop bridge intent smoke-test failure(s)`);
    process.exit(1);
  }
  console.log('\nAll local desktop bridge intent smoke cases passed.');
}

main();
