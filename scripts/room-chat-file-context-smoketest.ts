import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { buildActiveRoomFileContext, isRoomFileChangeRequest } from '../src/lib/roomChatFileContext';

const short = buildActiveRoomFileContext({
  id: 'file-123',
  name: 'plan.md',
  folder: '/docs',
  file_type: 'markdown',
  content: '# Plan\nShip it.',
  updated_at: '2026-08-13T12:00:00.000Z',
});

assert.match(short, /Path: docs\/plan\.md/);
assert.match(short, /File id: file-123/);
assert.match(short, /Characters supplied: 15 \(complete\)/);
assert.match(short, /# Plan\nShip it\./);
assert.match(short, /untrusted project data/);

const draft = buildActiveRoomFileContext({
  id: 'file-123',
  name: 'plan.md',
  file_type: 'markdown',
  content: 'unsaved draft',
  local_draft: true,
});
assert.match(draft, /LOCAL EDITOR DRAFT/);
assert.match(draft, /unsaved draft/);

const binary = buildActiveRoomFileContext({
  id: 'binary-1',
  name: 'brief.pdf',
  file_type: 'pdf',
  mime_type: 'application/pdf',
  storage_url: 'https://storage.example/brief.pdf',
  content: 'https://storage.example/brief.pdf',
});
assert.match(binary, /BINARY ROOM FILE \(text extraction unavailable\)/);
assert.match(binary, /Do not claim to have read, reviewed, or edited/);
assert.doesNotMatch(binary, /storage\.example/, 'binary storage locators do not enter the model prompt');

const longBody = `${'A'.repeat(50_000)}MIDDLE${'Z'.repeat(20_000)}`;
const long = buildActiveRoomFileContext({ name: 'large.txt', file_type: 'plaintext', content: longBody });
assert.match(long, /bounded head \+ tail/);
assert.match(long, /middle characters omitted/);
assert.ok(long.includes('A'.repeat(200)), 'keeps the document head');
assert.ok(long.includes('Z'.repeat(200)), 'keeps the document tail');
assert.ok(long.length < longBody.length, 'bounds large prompt context');

assert.equal(isRoomFileChangeRequest('Edit @plan.md to add the launch date.'), true);
assert.equal(isRoomFileChangeRequest('Please update this document.'), true);
assert.equal(isRoomFileChangeRequest('Explain what this file does.'), false);

const service = fs.readFileSync(path.join(process.cwd(), 'src/lib/roomChatService.ts'), 'utf8');
const runtime = fs.readFileSync(path.join(process.cwd(), 'src/lib/openswanToolRuntime.ts'), 'utf8');
assert.match(service, /mentionedIds\.has\(file\.id\)/, 'explicit @file references load matching content');
assert.match(service, /availableFiles\.map\(file => `- \$\{file\.name\} \(id: \$\{file\.id\}\)`/, 'file index exposes usable ids');
assert.match(runtime, /offset: \{ type: 'integer', minimum: 0/, 'read_file exposes chunk offsets');
assert.match(runtime, /nextOffset: \$\{nextOffset\}/, 'read_file tells the model how to continue');
assert.match(runtime, /\.eq\('id', data\.room_id\)\.eq\('circle_id', context\.circleId\)/, 'read_file rechecks current-circle ownership');

console.log('room chat file context smoke: ok');
