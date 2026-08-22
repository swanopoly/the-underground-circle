import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const helper = fs.readFileSync(path.join(process.cwd(), 'src/lib/builderGithubSave.ts'), 'utf8');
const github = fs.readFileSync(path.join(process.cwd(), 'src/lib/github.ts'), 'utf8');
const commands = fs.readFileSync(path.join(process.cwd(), 'src/lib/githubChatCommands.ts'), 'utf8');
const modal = fs.readFileSync(path.join(process.cwd(), 'src/screens/circles/tabs/chat/BuilderGithubSaveModal.tsx'), 'utf8');

assert.match(helper, /export async function submitFilesToGitHub/);
assert.match(helper, /commitMultipleFiles\(/);
assert.match(helper, /await Promise\.all\(files\.map/);
assert.match(helper, /result\.content !== file\.content/);
assert.match(helper, /createDraftPullRequest/);
assert.match(helper, /createPullRequest\(/);
assert.match(helper, /Duplicate GitHub file path/);
assert.match(helper, /Submit at most 100 files/);
assert.match(helper, /max 900 KB/);
assert.match(helper, /5 MB verified submission limit/);
assert.match(helper, /normalizeGitHubBranch/);

assert.match(github, /git\/commits\/\$\{encodeURIComponent\(baseSha\)\}/);
assert.match(github, /base_tree: baseTreeSha/);
assert.ok((commands.match(/filePath, repo\.branch/g) || []).length >= 2, 'Room GitHub cat/edit reads use the selected branch');

assert.match(modal, /accessibilityRole="checkbox"/);
assert.match(modal, /Open a draft pull request/);
assert.match(modal, /VERIFIED/);
assert.match(modal, /initialRepoFullName/);

console.log('room GitHub submit smoke: ok');
