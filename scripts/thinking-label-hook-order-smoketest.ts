import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync('src/components/chat-animations/ThinkingLabel.tsx', 'utf8');

assert.match(source, /function WebThinkingLabel\([\s\S]*?useState\(text\)/, 'web animation owns its hooks');
assert.match(source, /function NativeThinkingLabel\([\s\S]*?useRef\(new Animated\.Value\(1\)\)/, 'native animation owns its hooks');
assert.match(
  source,
  /export default function ThinkingLabel\(props: ThinkingLabelProps\) \{[\s\S]*?Platform\.OS === 'web'[\s\S]*?<WebThinkingLabel[\s\S]*?<NativeThinkingLabel/,
  'platform selection renders separate hook-stable components',
);
assert.doesNotMatch(
  source,
  /export default function ThinkingLabel\([^)]*\)[\s\S]*?use(?:State|Effect|Ref|Memo|Callback)\(/,
  'the platform-selecting wrapper owns no hooks',
);
assert.doesNotMatch(
  source,
  /if \(Platform\.OS === 'web'\) \{[\s\S]*?useState\(/,
  'web-only hooks are not placed after an in-component platform branch',
);

console.log('ThinkingLabel hook-order smoke passed');
