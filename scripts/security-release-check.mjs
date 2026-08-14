#!/usr/bin/env node

import { spawnSync } from 'node:child_process';

const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';

const npmScripts = [
  'check:public-env-security',
  'smoke:dependency-override-compat',
  'smoke:expo-image-asset-guard',
  'check:expo-image-assets',
  'smoke:auth-session',
  'smoke:auth-security-flow',
  'smoke:auth-logout-storage-security',
  'smoke:oauth-token-browser-boundary',
  'smoke:profiles-auth-user-delete-cascade',
  'smoke:chat-send-boundary',
  'smoke:circles-flexible-schema-alignment',
  'smoke:circle-creator-membership-alignment',
  'smoke:circle-default-chat-thread-bootstrap',
  'smoke:start-dev-dependency-watch',
  'smoke:netlify-csp-security',
  'smoke:local-secrets',
  'smoke:oauth-popup-boundary',
  'smoke:browser-provider-key-boundary',
  'smoke:public-collaboration-rls-security',
  'smoke:circle-public-access-emergency-security',
  'smoke:circle-client-safe-rpc',
  'smoke:circle-integration-secret-rpc-security',
  'smoke:site-credential-key-rotation-security',
  'smoke:security-definer-emergency-lockdown',
  'smoke:public-function-search-path-security',
  'smoke:llm-proxy-security',
  'smoke:llm-proxy-client-error',
  'smoke:room-task-executor-security',
  'smoke:swanbot-circle-auth-boundary',
  'smoke:swanbot-v2-batch-policy',
  'smoke:automation-executor-mutation-guard',
  'smoke:github-webhook-security',
  'smoke:task-images-storage-security',
  'smoke:view-build-security',
  'smoke:build-stream-security',
  'smoke:desktop-bridge-security',
  'typecheck:app',
  'typecheck:functions',
  'build',
  'check:public-bundle-security',
];

function run(args, label) {
  console.log(`\n[security-release] ${label}`);
  const result = spawnSync(npmCommand, args, {
    cwd: process.cwd(),
    env: process.env,
    stdio: 'inherit',
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

for (const script of npmScripts) {
  run(['run', script], `npm run ${script}`);
}

run(['ls', '--depth=0'], 'top-level dependency tree');
run(['audit', '--omit=dev', '--audit-level=high'], 'production dependency audit (high/critical gate)');

console.log('\n[security-release] PASS');
