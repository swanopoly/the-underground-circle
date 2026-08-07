/**
 * Regression guard for the complete ChatTab send boundary.
 *
 * Chat loads several route/context modules before the main agent branch. A
 * rejected lazy import used to escape the narrower main-agent catch and leave
 * the composer looking unresponsive. This source-level smoke keeps the outer
 * boundary, state reset, recoverable message, and no-agent-launch fallback
 * wired around the entire send pipeline.
 */

import fs from 'node:fs';
import path from 'node:path';

const sourcePath = path.resolve('src/screens/circles/tabs/ChatTab.tsx');
const source = fs.readFileSync(sourcePath, 'utf8');

let assertions = 0;
function assert(condition: unknown, message: string): void {
  assertions += 1;
  if (!condition) throw new Error(`FAIL: ${message}`);
}

const unsafeStart = source.indexOf('const sendMessageUnsafe = async (');
const wrapperStart = source.indexOf('const sendMessage = async (', unsafeStart + 1);
const quickActionsStart = source.indexOf('const handleQuickActionSelection', wrapperStart + 1);

assert(unsafeStart >= 0, 'the full send pipeline has an explicitly unsafe inner function');
assert(wrapperStart > unsafeStart, 'the safe send wrapper is declared after the inner pipeline');
assert(quickActionsStart > wrapperStart, 'all downstream callers receive the safe wrapper');

const unsafeBody = source.slice(unsafeStart, wrapperStart);
const wrapperBody = source.slice(wrapperStart, quickActionsStart);

assert(
  unsafeBody.includes("await import('../../../lib/memoryIntentCore')"),
  'the formerly escaping memory-intent lazy import remains inside the wrapped pipeline',
);
assert(
  wrapperBody.includes('await sendMessageUnsafe(overrideText, options);'),
  'the wrapper awaits the entire send pipeline',
);
assert(wrapperBody.includes('} catch (error) {'), 'the wrapper catches rejected sends');
assert(wrapperBody.includes('sendLockRef.current = false;'), 'a rejected send releases the composer lock');
assert(wrapperBody.includes("setRunStatus('idle');"), 'a rejected send returns the run to idle');
assert(wrapperBody.includes('setBotTyping(false);'), 'a rejected send clears the typing state');
assert(
  wrapperBody.includes("executionKind: 'chat_send_boundary'"),
  'a rejected send emits a typed recoverable failure',
);
assert(
  wrapperBody.includes('launchIfMissing: false'),
  'module recovery never launches an external agent or steals window focus',
);
assert(
  wrapperBody.includes('Chat could not load a required module. Refresh the app'),
  'a local-only fallback remains available if recovery rendering also fails',
);
assert(
  !unsafeBody.includes('const handleQuickActionSelection'),
  'quick actions are not captured inside the unsafe pipeline',
);
assert(
  source.includes('accessibilityLabel="Send message"'),
  'the chat send control remains discoverable to accessibility and browser automation',
);

console.log(`chat-send-boundary-smoketest: ${assertions} assertions passed`);
