import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const source = fs.readFileSync(path.join(process.cwd(), 'src/screens/circles/tabs/RoomsTab.tsx'), 'utf8');
const chatStart = source.indexOf('function ChatPanel(');
const chatEnd = source.indexOf('function FileProposalCard(', chatStart);
assert.ok(chatStart >= 0 && chatEnd > chatStart, 'finds the mounted legacy ChatPanel');
const chat = source.slice(chatStart, chatEnd);

assert.match(chat, />Room chat</);
assert.match(chat, /accessibilityLabel="Search room messages"/);
assert.match(chat, /accessibilityLabel="Open room chat settings and actions"/);
assert.match(chat, /Unsaved editor draft is in context/);
assert.match(chat, /Submit to GitHub/);
assert.match(chat, /getRoomChatSessionActions\(sessionProfile\)\.slice\(0, 3\)/);
assert.match(source, /accessibilityLabel="Open message actions"/);
assert.match(chat, /proposalDecisionsByMessage/, 'proposal decisions are derived from immutable events');
assert.match(chat, /proposal_decision: 'applied'/, 'Apply writes an immutable decision receipt');
assert.match(chat, /proposal_decision: 'rejected'/, 'Reject writes an immutable decision receipt');
assert.doesNotMatch(chat, /appliedProposals: applied/, 'Apply does not UPDATE the immutable source message');
assert.match(chat, /github_submission_review_required/, 'legacy GitHub writes redirect to reviewed submission');
assert.match(chat, /repoFullName: githubRepoFullName \|\| undefined/, 'read-only GitHub commands stay on the Room-selected repo');
assert.match(chat, />Submit files to GitHub</, 'GitHub review remains available without an open document');
assert.match(chat, /Binary preview only · text extraction is not available in Room chat/, 'binary previews do not claim readable text');
assert.match(source, /!file\.storage_url/, 'storage-backed binary locators are never submitted as text files');

assert.equal((chat.match(/>SOUL MODE</g) || []).length, 0, 'removes always-visible soul strip');
assert.equal((chat.match(/>Assign<\/Text>/g) || []).length, 0, 'removes header Assign button');
assert.equal((chat.match(/>FIND/g) || []).length, 0, 'uses readable Search copy');
assert.equal((chat.match(/label: 'Types'/g) || []).length, 0, 'removes six-pill file action row');

console.log('room chat minimal UI smoke: ok');
