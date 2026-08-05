#!/usr/bin/env node

import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { spawnSync } from 'node:child_process';

const bridge = fs.readFileSync('scripts/claude-bridge.js', 'utf8');
const swift = fs.readFileSync('scripts/bin/uc-input-helper.swift', 'utf8');
let assertions = 0;

function check(condition, message) {
  assert.ok(condition, message);
  assertions += 1;
}

function extract(source, start, end) {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex);
  assert.notEqual(startIndex, -1, `missing extraction start: ${start}`);
  assert.notEqual(endIndex, -1, `missing extraction end: ${end}`);
  return source.slice(startIndex, endIndex);
}

const helperContractSource = extract(
  bridge,
  'function isValidDesktopNativeAppNameServer',
  '/* UC_SMOKE_EXTRACT_START shellSingleQuote */',
);
const helperContract = vm.runInNewContext(
  `${helperContractSource}\n({ parseDesktopNativeTargetGuardServer, classifyDesktopInputHelperFailure })`,
);

const validGuard = {
  appName: 'Adobe Photoshop',
  pid: 2_147_483_647,
  window: {
    id: 4_294_967_295,
    x: -32_768,
    y: 32_768,
    width: 32_768,
    height: 1,
  },
};
check(helperContract.parseDesktopNativeTargetGuardServer(validGuard).ok === true, 'Swift numeric maxima are accepted');
check(helperContract.parseDesktopNativeTargetGuardServer({ ...validGuard, pid: '42' }).ok === false, 'numeric-string PID is rejected');
check(helperContract.parseDesktopNativeTargetGuardServer({ ...validGuard, pid: 2_147_483_648 }).ok === false, 'PID above Int32.max is rejected');
check(helperContract.parseDesktopNativeTargetGuardServer({ ...validGuard, window: { ...validGuard.window, id: '42' } }).ok === false, 'numeric-string CGWindowID is rejected');
check(helperContract.parseDesktopNativeTargetGuardServer({ ...validGuard, window: { ...validGuard.window, id: 4_294_967_296 } }).ok === false, 'CGWindowID above UInt32.max is rejected');
check(helperContract.parseDesktopNativeTargetGuardServer({ ...validGuard, appName: 'Éditeur 🎨' }).ok === true, 'bounded Unicode app name is accepted');
check(helperContract.parseDesktopNativeTargetGuardServer({ ...validGuard, appName: 'Bad\nApp' }).ok === false, 'control characters in app name are rejected');
check(helperContract.parseDesktopNativeTargetGuardServer({ ...validGuard, window: { ...validGuard.window, x: 32_769 } }).ok === false, 'out-of-range bounds are rejected');

const uncertainFailure = helperContract.classifyDesktopInputHelperFailure(
  new Error('exit 1'),
  '{"ok":false,"error":"frontmost drift","errorCode":"uncertain_ui_target"}',
  '',
);
check(uncertainFailure.errorCode === 'uncertain_ui_target', 'helper uncertain_ui_target survives stdout JSON parsing');
const permissionFailure = helperContract.classifyDesktopInputHelperFailure(
  new Error('exit 1'),
  '',
  '{"ok":false,"error":"Accessibility permission not granted","errorCode":"permission_denied"}',
);
check(permissionFailure.errorCode === 'permission_denied', 'helper permission_denied survives stderr JSON parsing');
const missingFailure = helperContract.classifyDesktopInputHelperFailure(
  Object.assign(new Error('spawn failed'), { code: 'ENOENT' }),
  '',
  '',
);
check(missingFailure.errorCode === 'helper_missing', 'ENOENT is preserved as helper_missing');

const comboSource = extract(
  bridge,
  'const MODIFIER_TOKENS',
  '// Cached result of `which <cmd>` probes.',
);
const comboContract = vm.runInNewContext(`${comboSource}\n({ keyComboToNativeInput })`);
check(JSON.stringify(comboContract.keyComboToNativeInput('Cmd+T')) === JSON.stringify({ keyCode: 17, modifiers: ['command'] }), 'Cmd+T compiles to bounded native key input');
check(JSON.stringify(comboContract.keyComboToNativeInput('Cmd+Shift+N')) === JSON.stringify({ keyCode: 45, modifiers: ['command', 'shift'] }), 'multi-modifier combo is normalized deterministically');
check(comboContract.keyComboToNativeInput('Cmd+Command+T') === null, 'duplicate modifier aliases are rejected');
check(comboContract.keyComboToNativeInput('Cmd+VolumeUp') === null, 'unsupported terminal keys are rejected');

const typeRoute = extract(bridge, "if (url === '/desktop/type'", "if (url === '/desktop/keys'");
const keysRoute = extract(bridge, "if (url === '/desktop/keys'", "if (url === '/desktop/menu_inventory'");
const pasteRoute = extract(bridge, "if (url === '/desktop/paste_text'", "if (url === '/desktop/file_grant'");
check(typeRoute.includes("['type', ...desktopNativeTargetGuardHelperArgs") && typeRoute.includes('stdin: text'), 'type route sends text to the guarded helper over stdin');
check(keysRoute.includes("'key'") && keysRoute.includes('keyComboToNativeInput'), 'keys route dispatches the bounded guarded key command');
check(!typeRoute.includes('osascript') && !keysRoute.includes('osascript') && !pasteRoute.includes('tell application "System Events" to keystroke'), 'type, key, and paste input no longer use proof-then-AppleScript dispatch');
check(pasteRoute.includes("'--key-code', '9', '--modifiers', 'command'"), 'paste uses guarded Command-V in the helper');
check(
  bridge.includes('if (appNameRaw && !isValidDesktopNativeAppNameServer(appNameRaw))'),
  'fresh app observation uses the shared bounded Unicode app-name contract',
);
check(bridge.includes("res.writeHead(200, CORS);\n        res.end(JSON.stringify({\n          ok: false,\n          code: 'pairing_challenge_required'"), 'pairing challenge first leg is a successful HTTP negotiation');

check(swift.includes('case "type":') && swift.includes('case "key":'), 'Swift helper exposes guarded type and key subcommands');
check(swift.includes('func boundedStdinText()') && swift.includes('text.utf16.count <= 4_000'), 'Swift text input has independent byte and UTF-16 bounds');
check(swift.includes('func unicodeInputChunks') && swift.includes('maxUtf16Units: Int = 32'), 'Swift text dispatch is chunk bounded');
check(swift.includes('up.post(tap: .cghidEventTap)') && swift.includes('errorCode: .uncertainUiTarget'), 'Swift helper has emergency key-up and structured target-drift failures');

if (process.platform === 'darwin') {
  const typecheck = spawnSync('swiftc', ['-typecheck', 'scripts/bin/uc-input-helper.swift'], {
    encoding: 'utf8',
    timeout: 30_000,
  });
  assert.equal(typecheck.status, 0, typecheck.stderr || typecheck.stdout || 'Swift helper typecheck failed');
  assertions += 1;
}

console.log(`native-input-helper-contract-smoketest: ${assertions} assertions passed`);
