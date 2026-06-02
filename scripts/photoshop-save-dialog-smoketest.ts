import assert from 'node:assert/strict';
import {
  findPreferredSaveForWebFormatControl,
  findPreferredSaveForWebFormatOption,
  findPreferredSaveExtensionMismatchButton,
  findPreferredSaveReplaceExistingButton,
  isStatableLocalSavePath,
  normalizeFileExtension,
  normalizeSaveForWebTargetFormat,
  treeShowsSaveForWebTargetFormat,
  treeLooksLikeSaveExtensionMismatchDialog,
  treeLooksLikeSaveReplaceExistingDialog,
  type ComputerAppSaveDialogNode,
} from '../src/lib/computerAppSaveDialogs';

const extensionMismatchTree: ComputerAppSaveDialogNode = {
  id: '0',
  role: 'AXWindow',
  label: 'Adobe Photoshop',
  children: [
    {
      id: '0.1',
      role: 'AXStaticText',
      label: 'You have used the extension “.png” at the end of the name. The standard extension is “.jpg”.',
    },
    { id: '0.2', role: 'AXButton', label: 'Use .jpg' },
    { id: '0.3', role: 'AXButton', label: 'Use .png' },
    { id: '0.4', role: 'AXButton', label: 'Cancel' },
  ],
};

const imageOptionsTree: ComputerAppSaveDialogNode = {
  id: '0',
  role: 'AXWindow',
  label: 'PNG Options',
  children: [
    { id: '0.1', role: 'AXStaticText', label: 'PNG Options' },
    { id: '0.2', role: 'AXButton', label: 'OK' },
  ],
};

const replaceExistingTree: ComputerAppSaveDialogNode = {
  id: '0',
  role: 'AXWindow',
  label: 'Adobe Photoshop',
  children: [
    { id: '0.1', role: 'AXStaticText', label: '“lmao.png” already exists. Do you want to replace it?' },
    { id: '0.2', role: 'AXButton', label: 'Cancel' },
    { id: '0.3', role: 'AXButton', label: 'Replace' },
  ],
};

const saveForWebJpegTree: ComputerAppSaveDialogNode = {
  id: '0',
  role: 'AXWindow',
  label: 'Save for Web',
  children: [
    { id: '0.1', role: 'AXStaticText', label: 'Optimized' },
    { id: '0.2', role: 'AXPopUpButton', label: 'Format', value: 'JPEG' },
    { id: '0.3', role: 'AXButton', label: 'Save' },
  ],
};

const saveForWebFormatMenuTree: ComputerAppSaveDialogNode = {
  id: '0',
  role: 'AXWindow',
  label: 'Save for Web',
  children: [
    { id: '0.1', role: 'AXMenuItem', label: 'GIF' },
    { id: '0.2', role: 'AXMenuItem', label: 'JPEG' },
    { id: '0.3', role: 'AXMenuItem', label: 'PNG-8' },
    { id: '0.4', role: 'AXMenuItem', label: 'PNG-24' },
  ],
};

const saveForWebPngTree: ComputerAppSaveDialogNode = {
  id: '0',
  role: 'AXWindow',
  label: 'Save for Web',
  children: [
    { id: '0.1', role: 'AXStaticText', label: 'Optimized' },
    { id: '0.2', role: 'AXPopUpButton', label: 'Format', value: 'PNG-24' },
    { id: '0.3', role: 'AXButton', label: 'Save' },
  ],
};

assert.equal(normalizeFileExtension('~/Desktop/lmao.png'), 'png', 'normalizes path extension');
assert.equal(normalizeFileExtension('export.JPG'), 'jpg', 'normalizes uppercase extension');
assert.equal(normalizeSaveForWebTargetFormat('~/Desktop/lmao.png'), 'png', 'derives Save for Web PNG target from output path');
assert.equal(normalizeSaveForWebTargetFormat('jpg'), 'jpg', 'normalizes Save for Web JPEG target');
assert.equal(isStatableLocalSavePath('~/Desktop/lmao.png'), true, 'tilde desktop output can be verified with file stat');
assert.equal(isStatableLocalSavePath('/Users/cswanson/Desktop/lmao.png'), true, 'absolute output can be verified with file stat');
assert.equal(isStatableLocalSavePath('lmao.png'), false, 'filename-only output is not stat verified without a folder');

assert(
  treeLooksLikeSaveExtensionMismatchDialog(extensionMismatchTree, 'lmao.png'),
  'detects macOS extension mismatch dialog for target PNG',
);
assert(
  !treeLooksLikeSaveExtensionMismatchDialog(extensionMismatchTree, 'lmao.jpg'),
  'does not treat mismatch dialog as matching the wrong target extension',
);
assert(
  !treeLooksLikeSaveExtensionMismatchDialog(imageOptionsTree, 'lmao.png'),
  'does not confuse PNG options with an extension mismatch',
);
assert(
  treeLooksLikeSaveReplaceExistingDialog(replaceExistingTree, 'lmao.png'),
  'detects the existing-file replace confirmation for the requested filename',
);
assert(
  !treeLooksLikeSaveReplaceExistingDialog(replaceExistingTree, 'other.png'),
  'does not replace a different filename than the requested output',
);

const replaceExisting = findPreferredSaveReplaceExistingButton(replaceExistingTree);
assert.equal(replaceExisting?.label, 'Replace', 'auto-selects Replace for requested output overwrite');

const keepPng = findPreferredSaveExtensionMismatchButton(extensionMismatchTree, 'lmao.png');
assert.equal(keepPng?.label, 'Use .png', 'prefers keeping the user-requested PNG extension');

const keepJpg = findPreferredSaveExtensionMismatchButton(extensionMismatchTree, 'lmao.jpg');
assert.equal(keepJpg?.label, 'Use .jpg', 'can also keep requested JPG when that is the target');

const missingCorrectButton: ComputerAppSaveDialogNode = {
  id: '0',
  role: 'AXWindow',
  children: [
    {
      id: '0.1',
      role: 'AXStaticText',
      label: 'You have used the extension “.png” at the end of the name. The standard extension is “.jpg”.',
    },
    { id: '0.2', role: 'AXButton', label: 'Use .jpg' },
    { id: '0.3', role: 'AXButton', label: 'Cancel' },
  ],
};

assert.equal(
  findPreferredSaveExtensionMismatchButton(missingCorrectButton, 'lmao.png'),
  null,
  'does not click the standard-extension button when the requested extension button is missing',
);

assert.equal(
  treeShowsSaveForWebTargetFormat(saveForWebJpegTree, 'png'),
  false,
  'does not treat a JPEG Save for Web setting as ready for PNG export',
);
assert.equal(
  treeShowsSaveForWebTargetFormat(saveForWebPngTree, 'png'),
  true,
  'detects when Save for Web is already set to PNG',
);
assert.equal(
  findPreferredSaveForWebFormatControl(saveForWebJpegTree, 'png')?.value,
  'JPEG',
  'finds the Save for Web format picker when it must be changed to PNG',
);
assert.equal(
  findPreferredSaveForWebFormatOption(saveForWebFormatMenuTree, 'png')?.label,
  'PNG-24',
  'prefers PNG-24 when the user requested a PNG export',
);
assert.equal(
  findPreferredSaveForWebFormatOption(saveForWebFormatMenuTree, 'jpg')?.label,
  'JPEG',
  'selects JPEG when the user requested a JPG export',
);

console.log('All Photoshop save dialog smoke cases passed.');
