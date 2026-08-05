import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const edgeSource = readFileSync('supabase/functions/swanbot-v2-ai/index.ts', 'utf8');
const start = edgeSource.indexOf('name: "browser.fill_field"');
const end = edgeSource.indexOf('name: "browser.fill_credential_field"', start);

assert(start >= 0 && end > start, 'browser.fill_field edge definition is present');
const fillDefinition = edgeSource.slice(start, end);

assert.match(
  fillDefinition,
  /Drafts non-secret text into one exact textbox or searchbox/,
  'description exposes the sealed non-secret exact-target contract',
);
assert.match(
  fillDefinition,
  /This action never submits/,
  'description explicitly excludes submit behavior',
);
assert.match(
  fillDefinition,
  /enum: \["textbox", "searchbox"\]/,
  'role is bounded to textbox/searchbox',
);
assert.doesNotMatch(
  fillDefinition,
  /enum: \[[^\]]*"combobox"/,
  'combobox is not accepted by the fill schema',
);
assert.match(fillDefinition, /selector: \{/, 'exact selector fallback is exposed');
assert.match(fillDefinition, /maxLength: 500/, 'accessible name uses the canonical 500-char bound');
assert.match(fillDefinition, /maxLength: 1000/, 'selector/task context use the canonical 1000-char bound');
assert.match(fillDefinition, /maxLength: 4000/, 'draft text uses the canonical 4000-char bound');
assert.match(
  fillDefinition,
  /exact:\s*\{\s*type: "boolean",\s*enum: \[true\]/s,
  'optional exact-name matching cannot be set false',
);
assert.match(fillDefinition, /minimum: 500/, 'timeout has the canonical minimum');
assert.match(fillDefinition, /maximum: 30000/, 'timeout has the canonical maximum');
assert.match(fillDefinition, /required: \["text"\]/, 'text is the only unconditional model field');
assert.match(
  fillDefinition,
  /oneOf:\s*\[\s*\{\s*required: \["name"\], not: \{ required: \["selector"\] \} \},\s*\{\s*required: \["selector"\], not: \{ required: \["name"\] \} \}/s,
  'schema requires name xor selector',
);
assert.match(fillDefinition, /additionalProperties: false/, 'unknown/bypass fields fail closed');
assert.doesNotMatch(
  fillDefinition,
  /^\s*submit:\s*\{/m,
  'submit is excluded rather than model-controllable',
);

console.log('swanbot-v2 edge fill schema smoke passed (16 assertions)');
