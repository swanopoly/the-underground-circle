#!/usr/bin/env npx tsx

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const read = (relative: string) => fs.readFileSync(path.join(root, relative), 'utf8');

const migration = read('supabase/migrations/20260806190000_oauth_token_browser_boundary.sql');
const browserSources = [
  'src/lib/githubChatCommands.ts',
  'src/lib/reviewChatCommand.ts',
  'src/lib/googleDocsCreate.ts',
  'src/lib/googleWorkspaceRuntime.ts',
  'src/screens/circles/tabs/RoomsTab.tsx',
].map((file) => ({ file, source: read(file) }));

for (const table of ['user_google_credentials', 'user_github_tokens']) {
  assert.match(migration, new RegExp(`ALTER TABLE public\\.${table} ENABLE ROW LEVEL SECURITY`));
  assert.match(
    migration,
    new RegExp(`REVOKE ALL ON TABLE public\\.${table} FROM PUBLIC, anon, authenticated`),
  );
  assert.match(migration, new RegExp(`GRANT ALL ON TABLE public\\.${table} TO service_role`));
}

assert.match(migration, /tablename IN \('user_google_credentials', 'user_github_tokens'\)/);
assert.match(migration, /DROP POLICY IF EXISTS %I ON %I\.%I/);

for (const { file, source } of browserSources) {
  assert.doesNotMatch(
    source,
    /\.from\(['"]user_(?:google_credentials|github_tokens)['"]\)/,
    `${file} must not query provider-token tables from the browser`,
  );
}

const googleCreds = read('src/lib/googleCreds.ts');
assert.match(googleCreds, /google-oauth\?action=token/);
assert.doesNotMatch(googleCreds, /refresh_token\s*:/);

const githubOAuth = read('supabase/functions/github-oauth/index.ts');
assert.match(githubOAuth, /\.select\("github_username, github_user_id, created_at, updated_at"\)/);
assert.doesNotMatch(
  githubOAuth.slice(githubOAuth.indexOf('async function handleStatus')),
  /access_token\s*:/,
  'GitHub status must never return the access token',
);

console.log('OAuth token browser boundary smoke passed');
